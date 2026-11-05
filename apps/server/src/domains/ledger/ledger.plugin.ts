/**
 * Ledger domain assembly: the store (owning its database), the service
 * (running the record pruner) and the routes. AI disabled (no
 * TOBY_AI_MODEL) keeps the extractor undefined: the service then answers
 * the one-sentence path with 501. A shared agentFactory (traced, from the
 * composition root) takes precedence over the locally built one.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import {
  createTobyAgentFactory,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { createLedgerExtractor, type LedgerExtractor } from "./extraction.ts";
import { ledgerRoutes } from "./ledger.routes.ts";
import {
  createLedgerService,
  type LedgerService,
  type LedgerTiming,
} from "./ledger.service.ts";
import { createLedgerStore } from "./store.ts";

export interface LedgerPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** Test seam: a fake extractor in place of the real AI one. */
  extractor?: LedgerExtractor;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /** Test seam: write-timing knobs instead of the kernel defaults. */
  timing?: LedgerTiming;
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
 * (pruner, store close) stays in one place.
 */
export function createLedgerDomain(options: LedgerPluginOptions): LedgerDomain {
  const clock = options.clock ?? Date.now;
  const store = createLedgerStore({ config: options.config, clock });
  const buildExtractor = (): LedgerExtractor | undefined => {
    if (options.agentFactory) {
      return createLedgerExtractor({ agentFactory: options.agentFactory });
    }
    if (options.config.ai) {
      return createLedgerExtractor({
        agentFactory: createTobyAgentFactory(options.config.ai, {}),
      });
    }
    return undefined;
  };
  const extractor = options.extractor ?? buildExtractor();
  const service = createLedgerService({
    store,
    clock,
    extractor,
    timing: options.timing,
  });
  const plugin: FastifyPluginAsync = async (app) => {
    await app.register(ledgerRoutes, { service });
    service.start();
    // Teardown ordering: the pruner (and any prune still running) must
    // finish before the store closes the database. Do not reorder.
    app.addHook("onClose", async () => {
      await service.stop();
      await store.close();
    });
  };
  return { plugin, service };
}

export function ledgerPlugin(options: LedgerPluginOptions): FastifyPluginAsync {
  return createLedgerDomain(options).plugin;
}
