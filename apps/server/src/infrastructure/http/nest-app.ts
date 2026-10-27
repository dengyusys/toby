/**
 * The Nest application shell over Fastify: the raw-error adapter, and the
 * applyHttpContract step that installs the global filter and guard,
 * shutdown hooks, the x-request-id echo, the non-JSON content parser, the
 * two SPA static roots, and init. This file knows nothing about any
 * specific domain; domain modules, guards and providers arrive as Nest
 * module imports.
 */

import "reflect-metadata";
import type { CanActivate } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { EnvelopeExceptionFilter } from "./exception-filter.ts";
import { staticAssetsPlugin } from "./static-assets.ts";

/** Adapter options: proxy trust and the access-log level. */
export interface TobyAdapterOptions {
  /**
   * Trust X-Forwarded-For from a fronting reverse proxy (TOBY_TRUST_PROXY),
   * so request.ip and per-IP limits see real client addresses. Off by
   * default: enable only behind a proxy you control.
   */
  trustProxy?: boolean;
  /**
   * Access-log level (TOBY_LOG_LEVEL). Fastify builds its own pino
   * internally; its default serializers log method/url/host/IP only —
   * headers never enter the log, so no redaction is configured. Omit for
   * silence (tests); `logger: false` in createTobyAdapter would disable
   * access logging entirely.
   */
  logLevel?: string;
}

/** What callers (main, tests) need from the assembled app. */
export interface NestServer {
  /** light-my-request inject, bound to the underlying Fastify instance. */
  inject: FastifyInstance["inject"];
  listen(host: string, port: number): Promise<void>;
  close(): Promise<void>;
}

/** HTTP-level wiring applied to an already-created app. */
export interface HttpContractOptions {
  webRoot: string;
  mobileWebRoot: string;
  /** Static-asset warnings (missing SPA roots); omit for silence. */
  warn?: (message: string) => void;
  /**
   * Guard installed globally before init — the composition root's session
   * guard, resolved from the container (providers instantiate during
   * NestFactory.create / the testing module's compile). Passed as a value
   * because APP_GUARD registration is broken under the current ESM tooling
   * (see docs/decisions/idiomatic-nest-services.md).
   */
  globalGuard?: CanActivate;
}

/**
 * Keeps raw Fastify errors raw: the stock adapter rewrites FastifyError
 * into HttpException, discarding the FST_ERR_* code our exception filter
 * maps onto the public INVALID_JSON / PAYLOAD_TOO_LARGE envelopes.
 */
export class RawErrorFastifyAdapter extends FastifyAdapter {
  mapException(error: unknown): unknown {
    return error;
  }
}

/** The adapter with the server's fixed instance options applied. */
export function createTobyAdapter(
  options: TobyAdapterOptions = {},
): RawErrorFastifyAdapter {
  return new RawErrorFastifyAdapter({
    bodyLimit: 16 * 1024,
    ...(options.trustProxy ? { trustProxy: true } : {}),
    ...(options.logLevel
      ? { logger: { level: options.logLevel } }
      : { logger: false }),
  });
}

// Fallback parser for non-JSON content types: read as string; route
// families decide their own semantics.
function readBodyAsString(
  _request: FastifyRequest,
  body: string,
  done: (error: Error | null, result?: unknown) => void,
): void {
  done(null, body);
}

/**
 * Applies the HTTP-level contract to a created Nest application and
 * initializes it: the global exception filter and session guard, shutdown
 * hooks, the request-id echo, the wildcard content parser, the static SPA
 * roots, then app.init() so controllers are wired onto the adapter even
 * on the never-listening test path.
 */
export async function applyHttpContract(
  app: NestFastifyApplication,
  options: HttpContractOptions,
): Promise<NestServer> {
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  const warn = options.warn ?? (() => {});
  app.useGlobalFilters(new EnvelopeExceptionFilter(instance));
  if (options.globalGuard) {
    app.useGlobalGuards(options.globalGuard);
  } else {
    // A missing guard means every route answers unauthenticated; say so
    // through the warn channel instead of failing silently.
    warn("no global guard installed: every route is unauthenticated");
  }
  app.enableShutdownHooks();

  // Echo the request id back so a log line and the response that triggered
  // it can be correlated across client and server.
  instance.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  instance.addContentTypeParser("*", { parseAs: "string" }, readBodyAsString);

  await instance.register(staticAssetsPlugin, {
    webRoot: options.webRoot,
    mobileWebRoot: options.mobileWebRoot,
    warn,
  });

  // Controllers are wired onto the adapter during init (or listen); the
  // test path never listens, so init explicitly here.
  await app.init();

  return {
    inject: instance.inject.bind(instance),
    listen: async (host, port) => {
      // Nest's own signature is (port, host) — the reverse of ours.
      await app.listen(port, host);
    },
    close: () => app.close(),
  };
}
