/**
 * Ledger repository against a real sqlite database in a temporary
 * directory: batch inserts, month listing, month-window queries, day
 * rows, and the database's lazy open + close lifecycle underneath.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createLedgerDb, type LedgerDb } from "../../src/domains/ledger/db.ts";
import {
  createLedgerRepository,
  monthBounds,
  type LedgerRepository,
} from "../../src/domains/ledger/repository.ts";
import type { LedgerEntry } from "../../src/domains/ledger/types.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-ledger-repository-"));
const fixedNow = () => Date.parse("2026-10-20T08:00:00.000Z");

afterAll(async () => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// One isolated database per case: a fresh subdirectory per call. The
// database opens and migrates lazily, exactly as in the app.
let caseCounter = 0;

async function openLedger(): Promise<{
  db: LedgerDb;
  repository: LedgerRepository;
}> {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const db = createLedgerDb({ config });
  return { db, repository: createLedgerRepository({ db, clock: fixedNow }) };
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

describe("ledger repository", () => {
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
    const { db, repository } = await openLedger();
    try {
      const ids = await repository.insertTransactions([
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
      const rows = await repository.listMonthTransactions("2026-10");
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
    const { db, repository } = await openLedger();
    try {
      await repository.insertTransactions([
        entry({ date: "2026-08-15" }),
        entry({ date: "2026-10-02" }),
        entry({ date: "2026-10-09" }),
        entry({ date: "2025-12-31" }),
      ]);
      expect(await repository.listMonths()).toEqual([
        "2026-10",
        "2026-08",
        "2025-12",
      ]);
    } finally {
      await db.close();
    }
  });

  it("month queries never bleed adjacent months", async () => {
    const { db, repository } = await openLedger();
    try {
      await repository.insertTransactions([
        entry({ date: "2026-09-30" }),
        entry({ date: "2026-10-01" }),
        entry({ date: "2026-10-31" }),
        entry({ date: "2026-11-01" }),
      ]);
      const october = await repository.listMonthTransactions("2026-10");
      expect(october.map((row) => row.date)).toEqual([
        "2026-10-01",
        "2026-10-31",
      ]);
      const november = await repository.listMonthTransactions("2026-11");
      expect(november.map((row) => row.date)).toEqual(["2026-11-01"]);
    } finally {
      await db.close();
    }
  });

  it("day queries return only that date, in insertion order", async () => {
    const { db, repository } = await openLedger();
    try {
      await repository.insertTransactions([
        entry({ date: "2026-10-20", amount: 100 }),
        entry({ date: "2026-10-19", amount: 200 }),
        entry({ date: "2026-10-20", amount: 300 }),
      ]);
      const rows = await repository.listDayTransactions("2026-10-20");
      expect(rows.map((row) => row.amount)).toEqual([100, 300]);
      expect(await repository.listDayTransactions("2026-10-21")).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("empty database lists no months and empty month windows", async () => {
    const { db, repository } = await openLedger();
    try {
      expect(await repository.listMonths()).toEqual([]);
      expect(await repository.listMonthTransactions("2026-10")).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("updates only the patched columns and returns a before/after snapshot", async () => {
    const { db, repository } = await openLedger();
    try {
      const ids = await repository.insertTransactions([
        entry({ note: "午饭", amount: 3000 }),
      ]);
      const id = ids[0]!;
      const updated = await repository.updateTransaction(id, {
        amount: 3500,
        category: "交通",
        note: "",
      });
      expect(updated).toBeDefined();
      expect(updated!.before).toMatchObject({
        id,
        amount: 3000,
        category: "餐饮",
        note: "午饭",
      });
      expect(updated!.after).toMatchObject({
        id,
        amount: 3500,
        category: "交通",
        note: "",
      });
      // Untouched columns keep their values, created_at included.
      expect(updated!.after.created_at).toBe(updated!.before.created_at);
      expect(updated!.after.date).toBe("2026-10-20");
      const [row] = await repository.listDayTransactions("2026-10-20");
      expect(row).toEqual(updated!.after);
    } finally {
      await db.close();
    }
  });

  it("updating an unknown id changes nothing and answers undefined", async () => {
    const { db, repository } = await openLedger();
    try {
      await repository.insertTransactions([entry()]);
      expect(
        await repository.updateTransaction(999, { amount: 100 }),
      ).toBeUndefined();
      expect(await repository.listDayTransactions("2026-10-20")).toHaveLength(
        1,
      );
    } finally {
      await db.close();
    }
  });

  it("a closed database stays closed instead of reopening", async () => {
    const { db, repository } = await openLedger();
    await repository.listMonths();
    await db.close();
    await expect(repository.listMonths()).rejects.toThrow(/closed/);
    // Closing again is harmless.
    await db.close();
  });
});
