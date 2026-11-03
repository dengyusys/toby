/**
 * Ledger store: hand-written SQL over the domain database (integer cents, local
 * `YYYY-MM-DD` dates, UTC `created_at`). It owns the database lifecycle: open,
 * apply the schema, close on shutdown, memoized per process.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";
import type { LedgerEntry, LedgerTransactionRow } from "./types.ts";

/**
 * Idempotent DDL, applied on every open. SQLite needs a separate index
 * statement; MySQL declares the key inside the table (`CREATE INDEX` has no
 * `IF NOT EXISTS` there).
 */
const LEDGER_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      account TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)",
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      date CHAR(10) NOT NULL,
      type VARCHAR(7) NOT NULL,
      category VARCHAR(24) NOT NULL,
      account VARCHAR(24) NOT NULL,
      amount BIGINT NOT NULL,
      note VARCHAR(200) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      KEY idx_transactions_date (date)
    )`,
  ],
};

/** Exclusive month bounds: [first day, first day of next month). */
export function monthBounds(month: string): { start: string; end: string } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const nextYear = monthText === "12" ? year + 1 : year;
  const nextMonth =
    monthText === "12" ? "01" : String(Number(monthText) + 1).padStart(2, "0");
  return { start: `${month}-01`, end: `${nextYear}-${nextMonth}-01` };
}

export interface LedgerStore {
  /** Insert a whole proposal batch in one transaction; returns the ids. */
  insertTransactions(
    entries: readonly LedgerEntry[],
  ): Promise<readonly number[]>;
  listMonths(): Promise<readonly string[]>;
  listMonthTransactions(
    month: string,
  ): Promise<readonly LedgerTransactionRow[]>;
  /** Delete one row by id; true when the row existed. */
  deleteTransaction(id: number): Promise<boolean>;
  /** Close the database, if it was ever opened; the store stays closed. */
  close(): Promise<void>;
}

export function createLedgerStore(deps: {
  config: TobyConfig;
  clock: Clock;
}): LedgerStore {
  const { config, clock } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  /**
   * The opened database, opened once. A failed open forgets the memo, so a
   * transient failure retries instead of bricking the domain. Once closed,
   * the store stays closed: a late caller gets an error, never a fresh
   * handle nobody would close.
   */
  function db(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("ledger store is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "ledger");
      for (const statement of LEDGER_SCHEMA[handle.dialect]) {
        await handle.exec(statement);
      }
      return handle;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  }

  return {
    async insertTransactions(entries) {
      if (entries.length === 0) {
        return [];
      }
      const createdAt = new Date(clock()).toISOString();
      const handle = await db();
      return handle.transaction(async (tx) => {
        const ids: number[] = [];
        for (const entry of entries) {
          const result = await tx.run(
            "INSERT INTO transactions (date, type, category, account, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
              entry.date,
              entry.type,
              entry.category,
              entry.account,
              entry.amount,
              entry.note,
              createdAt,
            ],
          );
          ids.push(result.insertId ?? 0);
        }
        return ids;
      });
    },

    async listMonths() {
      const handle = await db();
      const rows = await handle.query<{ month: string }>(
        "SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC",
      );
      return rows.map((row) => row.month);
    },

    async listMonthTransactions(month) {
      const handle = await db();
      const { start, end } = monthBounds(month);
      return handle.query<LedgerTransactionRow>(
        "SELECT id, date, type, category, account, amount, note, created_at FROM transactions WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC",
        [start, end],
      );
    },

    async deleteTransaction(id) {
      const handle = await db();
      const result = await handle.run("DELETE FROM transactions WHERE id = ?", [
        id,
      ]);
      return result.changes > 0;
    },

    async close() {
      closed = true;
      const handle = await opening?.catch(() => undefined);
      await handle?.close();
      opening = undefined;
    },
  };
}
