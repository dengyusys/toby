/**
 * Ledger store: hand-written SQL over the database port. One transactions
 * table per the feature contract; money stays integer cents, dates are
 * local "YYYY-MM-DD" strings, created_at is a UTC ISO string for stable
 * ordering. DDL differs per dialect exactly where it must (auto-increment
 * column type); everything else sticks to the portable SQL subset.
 */

import type { DomainDb } from "../../infrastructure/db/types.ts";
import type { DomainMigrations } from "../../infrastructure/db/migrate.ts";
import type { LedgerEntry, LedgerTransactionRow } from "./types.ts";

export const LEDGER_MIGRATIONS: DomainMigrations = {
  steps: [
    {
      version: 1,
      sqlite: [
        `CREATE TABLE transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          type TEXT NOT NULL,
          category TEXT NOT NULL,
          account TEXT NOT NULL,
          amount INTEGER NOT NULL,
          note TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX idx_transactions_date ON transactions (date)",
      ],
      mysql: [
        `CREATE TABLE transactions (
          id INT PRIMARY KEY AUTO_INCREMENT,
          date CHAR(10) NOT NULL,
          type VARCHAR(7) NOT NULL,
          category VARCHAR(24) NOT NULL,
          account VARCHAR(24) NOT NULL,
          amount BIGINT NOT NULL,
          note VARCHAR(200) NOT NULL,
          created_at VARCHAR(32) NOT NULL
        )`,
        "CREATE INDEX idx_transactions_date ON transactions (date)",
      ],
    },
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
}

export function createLedgerStore(
  db: DomainDb,
  deps: { now: () => Date },
): LedgerStore {
  return {
    async insertTransactions(entries) {
      if (entries.length === 0) {
        return [];
      }
      const createdAt = deps.now().toISOString();
      return db.transaction(async (tx) => {
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
      const rows = await db.query<{ month: string }>(
        "SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC",
      );
      return rows.map((row) => row.month);
    },

    async listMonthTransactions(month) {
      const { start, end } = monthBounds(month);
      return db.query<LedgerTransactionRow>(
        "SELECT id, date, type, category, account, amount, note, created_at FROM transactions WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC",
        [start, end],
      );
    },
  };
}
