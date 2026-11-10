/**
 * Ledger repository: hand-written SQL over the domain database (db.ts
 * owns the connection and schema) — integer cents, local `YYYY-MM-DD`
 * dates, UTC `created_at`.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { LedgerDb } from "./db.ts";
import type { LedgerEntry, LedgerTransactionRow } from "./types.ts";

/** Exclusive month bounds: [first day, first day of next month). */
export function monthBounds(month: string): { start: string; end: string } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const nextYear = monthText === "12" ? year + 1 : year;
  const nextMonth =
    monthText === "12" ? "01" : String(Number(monthText) + 1).padStart(2, "0");
  return { start: `${month}-01`, end: `${nextYear}-${nextMonth}-01` };
}

export interface LedgerRepository {
  /** Insert a whole entry batch in one transaction; returns the ids. */
  insertTransactions(
    entries: readonly LedgerEntry[],
  ): Promise<readonly number[]>;
  listMonths(): Promise<readonly string[]>;
  listMonthTransactions(
    month: string,
  ): Promise<readonly LedgerTransactionRow[]>;
  /** Every transaction recorded on one local date, oldest first. */
  listDayTransactions(date: string): Promise<readonly LedgerTransactionRow[]>;
  /** Delete one row by id; true when the row existed. */
  deleteTransaction(id: number): Promise<boolean>;
}

export function createLedgerRepository(deps: {
  db: LedgerDb;
  clock: Clock;
}): LedgerRepository {
  const { db, clock } = deps;

  return {
    async insertTransactions(entries) {
      if (entries.length === 0) {
        return [];
      }
      const createdAt = new Date(clock()).toISOString();
      const handle = await db.open();
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
      const handle = await db.open();
      const rows = await handle.query<{ month: string }>(
        "SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC",
      );
      return rows.map((row) => row.month);
    },

    async listMonthTransactions(month) {
      const handle = await db.open();
      const { start, end } = monthBounds(month);
      return handle.query<LedgerTransactionRow>(
        "SELECT id, date, type, category, account, amount, note, created_at FROM transactions WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC",
        [start, end],
      );
    },

    async listDayTransactions(date) {
      const handle = await db.open();
      return handle.query<LedgerTransactionRow>(
        "SELECT id, date, type, category, account, amount, note, created_at FROM transactions WHERE date = ? ORDER BY id ASC",
        [date],
      );
    },

    async deleteTransaction(id) {
      const handle = await db.open();
      const result = await handle.run("DELETE FROM transactions WHERE id = ?", [
        id,
      ]);
      return result.changes > 0;
    },
  };
}
