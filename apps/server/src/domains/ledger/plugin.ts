/**
 * Ledger domain assembly: the database and the repository over it, the
 * service and the routes. AI disabled (no TOBY_AI_MODEL) keeps the
 * extractor undefined: the service then answers the one-sentence path
 * with 501. A shared agentFactory (traced, from the composition root)
 * takes precedence over the locally built one.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import {
  createTobyAgentFactory,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { createLedgerDb } from "./db.ts";
import {
  createLedgerExtractor,
  type LedgerExtractor,
  type LedgerMemoryPort,
} from "./extraction.ts";
import { ledgerRoutes } from "./routes.ts";
import { createLedgerService, type LedgerService } from "./service.ts";
import { createLedgerRepository } from "./repository.ts";

export interface LedgerPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** Test seam: a fake extractor in place of the real AI one. */
  extractor?: LedgerExtractor;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /**
   * The memory wiring port (docs/decisions/personal-agent-memory.md):
   * sentence-scoped `<memory>` section plus the shared conversational
   * memory tools for the extraction agent. A wiring port, not a domain
   * import — the composition root binds the memory service to it.
   */
  memory?: LedgerMemoryPort;
}

/** The assembled ledger domain: its mount step and its service handle. */
export interface LedgerDomain {
  readonly plugin: FastifyPluginAsync;
  readonly service: LedgerService;
}

/**
 * Builds the whole ledger domain and returns both its plugin and its
 * service — the composition root hands the service to other domains'
 * ports (chat); mounting still happens through the plugin so lifecycle
 * (pruner, database close) stays in one place.
 */
export function createLedgerDomain(options: LedgerPluginOptions): LedgerDomain {
  const clock = options.clock ?? Date.now;
  const db = createLedgerDb({ config: options.config });
  const repository = createLedgerRepository({ db, clock });
  const buildExtractor = (): LedgerExtractor | undefined => {
    const build = (factory: TobyAgentFactory): LedgerExtractor =>
      createLedgerExtractor({
        agentFactory: factory,
        ...(options.memory ? { memory: options.memory } : {}),
      });
    if (options.agentFactory) {
      return build(options.agentFactory);
    }
    if (options.config.ai) {
      return build(createTobyAgentFactory(options.config.ai, {}));
    }
    return undefined;
  };
  const extractor = options.extractor ?? buildExtractor();
  const service = createLedgerService({
    repository,
    clock,
    extractor,
  });
  const plugin: FastifyPluginAsync = async (app) => {
    await app.register(ledgerRoutes, { service });
    app.addHook("onClose", async () => {
      await db.close();
    });
  };
  return { plugin, service };
}
