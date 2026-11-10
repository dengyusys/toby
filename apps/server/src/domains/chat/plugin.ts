/**
 * Chat domain assembly: the database (owning chat.db) and the
 * repository over it, the intent classifier (enum and prompt lines
 * derived from the registered capabilities) and the read-only agent
 * (toolset and rules likewise registered; built from the shared traced
 * factory when AI is configured; absent AI keeps both undefined and the
 * service answers with honest notices), the rate limiter, and the
 * routes. Capabilities are validated at assembly — duplicate ids, the
 * reserved "none", or an empty tools-plus-rules signature fail the boot,
 * not the first message.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type { TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import type { AiClient } from "../../infrastructure/model/types.ts";
import type { ChatDomainCapability } from "../../chat-capability.ts";
import { createChatAgent } from "./agent.ts";
import { createChatService } from "./service.ts";
import { chatRoutes } from "./routes.ts";
import { createChatDb } from "./db.ts";
import { createIntentClassifier } from "./intent.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createChatRepository } from "./repository.ts";
import type { IntentClassifier } from "./types.ts";

export interface ChatPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /** The single-shot client: intent classification's expected consumer. */
  aiClient?: AiClient;
  /** The registered routable domains (composition-root registry). */
  capabilities?: readonly ChatDomainCapability[];
  /** Test seam: a fake classifier in place of the real AI one. */
  classifier?: IntentClassifier;
  /** Test seam: limiter knobs instead of the doc defaults. */
  rateLimit?: { limit?: number; windowMs?: number };
}

/**
 * Assembly-time validation: the registry must be well-formed before the
 * first message, not at it. "none" is chat's own intent; a capability
 * with neither tools nor rules would silently contribute nothing to the
 * none-agent — both are boot failures.
 */
function validateCapabilities(
  capabilities: readonly ChatDomainCapability[],
): readonly ChatDomainCapability[] {
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (capability.intent === "none") {
      throw new Error(
        `"none" is chat's own intent; a capability may not take it`,
      );
    }
    if (seen.has(capability.intent)) {
      throw new Error(`duplicate chat capability intent: ${capability.intent}`);
    }
    seen.add(capability.intent);
    if (capability.tools.length === 0) {
      throw new Error(
        `chat capability "${capability.intent}" registers no tools`,
      );
    }
  }
  return capabilities;
}

export function chatPlugin(options: ChatPluginOptions): FastifyPluginAsync {
  const clock = options.clock ?? Date.now;
  const capabilities = validateCapabilities(options.capabilities ?? []);
  const capabilityMap = new Map(
    capabilities.map((capability) => [capability.intent, capability]),
  );
  const db = createChatDb({ config: options.config });
  const repository = createChatRepository({ db, clock });
  const classifier =
    options.classifier ??
    (options.aiClient
      ? createIntentClassifier({
          client: options.aiClient,
          intents: capabilities,
        })
      : undefined);
  const agent = options.agentFactory
    ? createChatAgent({
        agentFactory: options.agentFactory,
        capabilities,
        clock,
      })
    : undefined;
  const service = createChatService({
    repository,
    clock,
    ...(classifier ? { classifier } : {}),
    ...(agent ? { agent } : {}),
    capabilities: capabilityMap,
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
      await db.close();
    });
  };
}
