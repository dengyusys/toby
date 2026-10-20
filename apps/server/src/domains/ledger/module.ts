/**
 * Ledger domain self-assembly: open the domain database, apply migrations,
 * build the service, and run the proposal sweeper until the app closes.
 * The composition root registers one line per domain — this is that line
 * for ledger.
 */

import type { MountedDomain } from "../../infrastructure/http/domain-mount.ts";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import { applyMigrations } from "../../infrastructure/db/migrate.ts";
import { createOpenAiCompatibleClient } from "../../infrastructure/ai/openai-compatible.ts";
import { ledgerRouter } from "./router.ts";
import { LEDGER_MIGRATIONS, createLedgerStore } from "./store.ts";
import { assembleLedgerService, type LedgerServiceDeps } from "./service.ts";

const SWEEP_INTERVAL_MS = 1_000;

export async function assembleLedger(
  config: TobyConfig,
  deps: LedgerServiceDeps = {},
): Promise<MountedDomain> {
  const db = await createDomainDb(config, "ledger");
  await applyMigrations(db, LEDGER_MIGRATIONS);
  const now = deps.now ?? Date.now;
  const store = createLedgerStore(db, { now: () => new Date(now()) });
  const service = assembleLedgerService(store, {
    ...deps,
    now,
    ai: deps.ai ?? createOpenAiCompatibleClient(config.ai),
  });

  const sweeper = setInterval(() => {
    void service.sweep();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  return {
    name: "ledger",
    plugin: async (app) => {
      app.addHook("onClose", async () => {
        clearInterval(sweeper);
        await db.close();
      });
      await app.register(ledgerRouter, { service });
    },
  };
}
