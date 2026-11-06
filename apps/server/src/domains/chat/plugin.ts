/**
 * Chat domain assembly: the store (owning chat.db), the intent
 * classifier and the read-only agent (built from the shared traced
 * factory when AI is configured; absent AI keeps both undefined and the
 * service answers with honest notices), the rate limiter, and the
 * routes. The ledger port is injected — never imported — the composition
 * root adapts the real ledger domain to it.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type { TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import type { AiClient } from "../../infrastructure/model/types.ts";
import { createChatAgent } from "./agent.ts";
import { createChatService } from "./service.ts";
import { chatRoutes } from "./routes.ts";
import { createIntentClassifier } from "./intent.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createChatStore } from "./store.ts";
import type { ChatLedgerPort, IntentClassifier } from "./types.ts";

export interface ChatPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /** The single-shot client: intent classification's expected consumer. */
  aiClient?: AiClient;
  /** The ledger as the chat domain sees it (composition-root adapter). */
  ledger?: ChatLedgerPort;
  /** Test seam: a fake classifier in place of the real AI one. */
  classifier?: IntentClassifier;
  /** Test seam: limiter knobs instead of the doc defaults. */
  rateLimit?: { limit?: number; windowMs?: number };
}

export function chatPlugin(options: ChatPluginOptions): FastifyPluginAsync {
  const clock = options.clock ?? Date.now;
  const store = createChatStore({ config: options.config, clock });
  const classifier =
    options.classifier ??
    (options.aiClient
      ? createIntentClassifier({ client: options.aiClient })
      : undefined);
  const agent =
    options.agentFactory && options.ledger
      ? createChatAgent({
          agentFactory: options.agentFactory,
          ledger: options.ledger,
          clock,
        })
      : undefined;
  const service = createChatService({
    store,
    clock,
    ...(classifier ? { classifier } : {}),
    ...(agent ? { agent } : {}),
    ...(options.ledger ? { ledger: options.ledger } : {}),
    limiter: createRateLimiter({
      now: clock,
      ...(options.rateLimit?.limit !== undefined
        ? { limit: options.rateLimit.limit }
        : {}),
      ...(options.rateLimit?.windowMs !== undefined
        ? { windowMs: options.rateLimit.windowMs }
        : {}),
    }),
  });
  return async (app) => {
    await app.register(chatRoutes, { service });
    app.addHook("onClose", async () => {
      await store.close();
    });
  };
}
