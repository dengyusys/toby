/**
 * Ledger store against a real sqlite database in a temporary directory:
 * migrations, batch inserts, month listing and month-window queries.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createDomainDb } from "../../src/infrastructure/db/create-db.ts";
import { applyMigrations } from "../../src/infrastructure/db/migrate.ts";
import {
  LEDGER_MIGRATIONS,
  monthBounds,
  createLedgerStore,
} from "../../src/domains/ledger/store.ts";
import type { LedgerEntry } from "../../src/domains/ledger/types.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-ledger-store-"));
const fixedNow = () => new Date("2026-10-20T08:00:00.000Z");

afterAll(async () => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// One isolated database per case: a fresh subdirectory per call.
let caseCounter = 0;

async function openStore() {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const db = await createDomainDb(config, "ledger");
  await applyMigrations(db, LEDGER_MIGRATIONS);
  return { store: createLedgerStore(db, { now: fixedNow }), db };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    account: "微信",
    amount: 2500,
    note: "午饭",
    ...overrides,
  };
}

describe("ledger store", () => {
  it("monthBounds computes exclusive [first, next-first) windows", () => {
    expect(monthBounds("2026-10")).toEqual({
      start: "2026-10-01",
      end: "2026-11-01",
    });
    expect(monthBounds("2026-12")).toEqual({
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });

  it("inserts a batch, returns ids, and reads the rows back", async () => {
    const { store, db } = await openStore();
    try {
      const ids = await store.insertTransactions([
        entry({ amount: 2500 }),
        entry({
          date: "2026-10-01",
          type: "income",
          category: "工资",
          account: "招行",
          amount: 500000,
        }),
      ]);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBeGreaterThan(0);
      const rows = await store.listMonthTransactions("2026-10");
      expect(rows).toHaveLength(2);
      expect(rows[0]!.date).toBe("2026-10-01");
      expect(rows[0]!.type).toBe("income");
      expect(rows[0]!.created_at).toBe("2026-10-20T08:00:00.000Z");
      expect(rows[1]!.amount).toBe(2500);
    } finally {
      await db.close();
    }
  });

  it("lists distinct months descending", async () => {
    const { store, db } = await openStore();
    try {
      await store.insertTransactions([
        entry({ date: "2026-08-15" }),
        entry({ date: "2026-10-02" }),
        entry({ date: "2026-10-09" }),
        entry({ date: "2025-12-31" }),
      ]);
      expect(await store.listMonths()).toEqual([
        "2026-10",
        "2026-08",
        "2025-12",
      ]);
    } finally {
      await db.close();
    }
  });

  it("month queries never bleed adjacent months", async () => {
    const { store, db } = await openStore();
    try {
      await store.insertTransactions([
        entry({ date: "2026-09-30" }),
        entry({ date: "2026-10-01" }),
        entry({ date: "2026-10-31" }),
        entry({ date: "2026-11-01" }),
      ]);
      const october = await store.listMonthTransactions("2026-10");
      expect(october.map((row) => row.date)).toEqual([
        "2026-10-01",
        "2026-10-31",
      ]);
      const november = await store.listMonthTransactions("2026-11");
      expect(november.map((row) => row.date)).toEqual(["2026-11-01"]);
    } finally {
      await db.close();
    }
  });

  it("empty database lists no months and empty month windows", async () => {
    const { store, db } = await openStore();
    try {
      expect(await store.listMonths()).toEqual([]);
      expect(await store.listMonthTransactions("2026-10")).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
