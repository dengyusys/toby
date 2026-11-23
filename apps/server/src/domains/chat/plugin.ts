/**
 * Chat domain assembly. The classifier and the agent are built from the
 * shared traced factory, which always exists and throws at run time when
 * nothing is configured. Capabilities are validated at assembly —
 * duplicate ids, the reserved "none", or an empty tool signature fail the
 * boot, not the first message.
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
import type { ChatMemoryPort, IntentClassifier } from "./types.ts";

export interface ChatPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /** The single-shot client: intent classification's expected consumer. */
  aiClient?: AiClient;
  /** The registered routable domains (composition-root registry). */
  capabilities?: readonly ChatDomainCapability[];
  /** The memory wiring port; absent memory changes nothing. */
  memory?: ChatMemoryPort;
  /** Test seam: a fake classifier in place of the real AI one. */
  classifier?: IntentClassifier;
  /**
   * The conversation window per send, in ms. Defaults to the boot config
   * (TOBY_CHAT_HISTORY_HOURS → 24h); the composition root passes the
   * settings resolver so a saved change lands on the next message.
   */
  resolveHistoryWindowMs?: () => Promise<number>;
  /** Test seam: limiter knobs instead of the doc defaults. */
  rateLimit?: { limit?: number; windowMs?: number };
}

/**
 * Assembly-time validation: the registry must be well-formed before the
 * first message, not at it. "none" is chat's own intent; a capability that
 * registers no tools would silently contribute nothing to the none-agent —
 * that is a boot failure.
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
  const intents: ReadonlySet<string> = new Set([
    "none",
    ...capabilities.map((capability) => capability.intent),
  ]);
  const repository = createChatRepository({ db, clock, intents });
  const classifier =
    options.classifier ??
    (options.aiClient
      ? createIntentClassifier({
          client: options.aiClient,
          intents: capabilities,
          ...(options.memory ? { memory: options.memory } : {}),
        })
      : undefined);
  const agent = options.agentFactory
    ? createChatAgent({
        agentFactory: options.agentFactory,
        capabilities,
        ...(options.memory ? { memory: options.memory } : {}),
        clock,
      })
    : undefined;
  const service = createChatService({
    repository,
    clock,
    resolveHistoryWindowMs:
      options.resolveHistoryWindowMs ??
      (() => Promise.resolve(options.config.chat.historyWindowMs)),
    ...(classifier ? { classifier } : {}),
    ...(agent ? { agent } : {}),
    ...(options.memory ? { memory: options.memory } : {}),
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
