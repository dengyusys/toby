/**
 * Ledger domain Nest module: opens the domain database, applies migrations,
 * assembles the service (including the AI extraction agent when
 * configured) and runs the proposal sweeper until the application shuts
 * down. AI disabled (no TOBY_AI_MODEL) keeps the extractor absent: the
 * service then answers the one-sentence path with 501.
 */

import { type DynamicModule } from "@nestjs/common";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Logger } from "../../infrastructure/logging/logger.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import { applyMigrations } from "../../infrastructure/db/migrate.ts";
import { createTobyAgentFactory } from "../../infrastructure/ai/agent.ts";
import { LEDGER_MIGRATIONS, createLedgerStore } from "./store.ts";
import { assembleLedgerService, type LedgerServiceDeps } from "./service.ts";
import { createLedgerExtractor, type LedgerExtractor } from "./extraction.ts";
import { LedgerController } from "./ledger.controller.ts";
import { LEDGER_SERVICE } from "./tokens.ts";

const LEDGER_LIFECYCLE = Symbol("LEDGER_LIFECYCLE");

// A 1 s tick bounds the auto-write moment's timing error to about a second.
const SWEEP_INTERVAL_MS = 1_000;

export interface LedgerNestDeps extends LedgerServiceDeps {
  logger?: Logger;
}

export async function createLedgerModule(
  config: TobyConfig,
  deps: LedgerNestDeps = {},
): Promise<DynamicModule> {
  const db = await createDomainDb(config, "ledger");
  await applyMigrations(db, LEDGER_MIGRATIONS);
  const now = deps.now ?? Date.now;
  const store = createLedgerStore(db, { now: () => new Date(now()) });
  const extractor: LedgerExtractor | undefined =
    deps.extractor ??
    (config.ai
      ? createLedgerExtractor({
          agentFactory: createTobyAgentFactory(config.ai, {
            logger: deps.logger,
          }),
        })
      : undefined);
  const service = assembleLedgerService(store, {
    ...deps,
    now,
    extractor,
    logger: deps.logger,
  });

  const sweeper = setInterval(() => {
    // sweep swallows commit failures internally; this catch only guards
    // future edits that let something else throw — Node 22 kills the
    // process on an unhandled rejection.
    service.sweep().catch((error: unknown) => {
      deps.logger?.error({ err: error }, "ledger sweep failed");
    });
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  class LedgerDomainModule {}
  const module: DynamicModule = {
    module: LedgerDomainModule,
    controllers: [LedgerController],
    providers: [
      { provide: LEDGER_SERVICE, useValue: service },
      {
        provide: LEDGER_LIFECYCLE,
        useValue: {
          onApplicationShutdown: async () => {
            clearInterval(sweeper);
            await db.close();
          },
        },
      },
    ],
  };
  return module;
}
