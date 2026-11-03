/**
 * Ledger domain assembly: the store (owning its database), the service
 * (running the proposal sweeper) and the routes. AI disabled (no
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
import { createLedgerService, type LedgerTiming } from "./ledger.service.ts";
import { createLedgerStore } from "./store.ts";

export interface LedgerPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** Test seam: a fake extractor in place of the real AI one. */
  extractor?: LedgerExtractor;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /** Test seam: proposal-timing knobs instead of the kernel defaults. */
  timing?: LedgerTiming;
}

export function ledgerPlugin(options: LedgerPluginOptions): FastifyPluginAsync {
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
  return async (app) => {
    await app.register(ledgerRoutes, { service });
    service.start();
    // Teardown ordering: the sweeper (and any sweep still running) must
    // finish before the store closes the database. Do not reorder.
    app.addHook("onClose", async () => {
      await service.stop();
      await store.close();
    });
  };
}
