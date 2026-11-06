/**
 * The composition root: the HTTP shell every application shares — body
 * limit, request timeout, the one error body, no-store, cookies, the SPA
 * roots — plus the domain assembly order (auth first: it provides the
 * session guard every later `/api` route gets by default). Production
 * `main.ts` listens on what this returns; tests drive it with their own
 * domain set. Logging is pino to stdout (docs/decisions/server-logging.md):
 * the request lifecycle lines plus the error boundary's stack-only 500
 * report, all carrying the request id.
 */

import cookie from "@fastify/cookie";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import pino from "pino";
import { authPlugin } from "./domains/auth/auth.plugin.ts";
import { chatPlugin } from "./domains/chat/chat.plugin.ts";
import type { ChatLedgerPort } from "./domains/chat/types.ts";
import { createLedgerDomain } from "./domains/ledger/ledger.plugin.ts";
import { systemPlugin } from "./domains/system/system.plugin.ts";
import { tracesPlugin } from "./domains/traces/traces.plugin.ts";
import type { TobyConfig } from "./infrastructure/config/config.ts";
import { createTobyAgentFactory } from "./infrastructure/model/agent.ts";
import { createPiAiClient } from "./infrastructure/model/client.ts";
import { createTraceBus } from "./infrastructure/trace/bus.ts";
import type { Clock } from "./infrastructure/clock.ts";
import { REQUEST_BODY_LIMIT_BYTES } from "./infrastructure/http/body-limit.ts";
import { registerBodyParsers } from "./infrastructure/http/body-parsers.ts";
import {
  errorHandler,
  frameworkErrorHandler,
} from "./infrastructure/http/error-handler.ts";
import { notFoundHandler } from "./infrastructure/http/not-found.ts";
import { guardApiRoutes } from "./infrastructure/http/route-guard.ts";
import { normalizeRequestUrl } from "./infrastructure/http/request-url.ts";
import {
  MOBILE_MOUNT,
  registerStaticAssets,
} from "./infrastructure/http/static.ts";

/**
 * Node's own default for receiving a whole request; Fastify's default (0)
 * would let a slow upload hold its socket — and shutdown — forever.
 */
const REQUEST_TIMEOUT_MS = 300_000;

/**
 * One domain's mount step; the composition root decides the order. It
 * returns what `app.register` returns — awaiting it waits for the plugin.
 */
export type DomainMount = (app: FastifyInstance) => PromiseLike<unknown> | void;

export interface AppOptions {
  config: TobyConfig;
  /** Replaces the production domain set (tests mount a subset or fakes). */
  domains?: readonly DomainMount[];
  /** Injectable logger; tests pass a capturing or silent one. */
  logger?: FastifyBaseLogger;
}

/** The production assembly: all domains behind the session guard. */
export function productionDomains(options: {
  config: TobyConfig;
  /** Injectable clock; tests typically pass a mutable closure. */
  clock?: Clock;
}): DomainMount[] {
  const { config, clock } = options;
  const auth = authPlugin({ config, clock });
  // One trace bus, two consumers: the AI runtime reports every run into
  // it, the traces domain streams it to the web monitor. Nothing is
  // stored — console semantics, live observation only.
  const traceBus = clock ? createTraceBus({ clock }) : createTraceBus();
  const agentFactory = config.ai
    ? createTobyAgentFactory(config.ai, { reporter: traceBus })
    : undefined;
  const aiClient = config.ai
    ? createPiAiClient(config.ai, { reporter: traceBus })
    : undefined;
  // The ledger domain is built here so the composition root can adapt its
  // service into chat's port — the only cross-domain wiring, done with
  // structural types, never domain-to-domain imports.
  const ledgerDomain = createLedgerDomain({
    config,
    clock,
    ...(agentFactory ? { agentFactory } : {}),
  });
  const chatLedgerPort: ChatLedgerPort = {
    recordFromText: (text) => ledgerDomain.service.createProposal({ text }),
    months: () => ledgerDomain.service.months(),
    monthReport: (month) => ledgerDomain.service.monthReport(month),
    dayReport: (date) => ledgerDomain.service.dayReport(date),
  };
  return [
    async (app) => {
      // Default-secure from here on: every `/api` route registered after
      // this hook carries the guard unless it is marked public.
      app.addHook("onRoute", guardApiRoutes(auth.requireSession));
      await app.register(auth.plugin);
    },
    (app) => app.register(systemPlugin({ clock })),
    (app) => app.register(ledgerDomain.plugin),
    (app) =>
      app.register(
        chatPlugin({
          config,
          clock,
          ...(agentFactory ? { agentFactory } : {}),
          ...(aiClient ? { aiClient } : {}),
          ledger: chatLedgerPort,
        }),
      ),
    (app) => app.register(tracesPlugin({ bus: traceBus })),
  ];
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({
    // One pino instance for everything: request lifecycle lines and the
    // error boundary's 500 report share it (and the request id). Structured
    // JSON on stdout — the process supervisor keeps the history. Fastify 5
    // takes a pre-built instance via `loggerInstance` (its `logger` option
    // only accepts a configuration object).
    loggerInstance: options.logger ?? pino({ name: "toby-server" }),
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    frameworkErrors: frameworkErrorHandler,
    // One rewrite, the two static layers' inherited rules: `/api/x/`
    // matches `/api/x`; in-root dot segments collapse before routing,
    // except where the mobile mount refuses them.
    rewriteUrl: (request) =>
      normalizeRequestUrl(request.url ?? "/", [MOBILE_MOUNT]),
  });

  registerBodyParsers(app);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  // Every response leaves no-store'd, static files and errors included.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  await app.register(cookie);
  await registerStaticAssets(app, options.config.paths);

  const domains =
    options.domains ?? productionDomains({ config: options.config });
  for (const mount of domains) {
    await mount(app);
  }
  return app;
}
