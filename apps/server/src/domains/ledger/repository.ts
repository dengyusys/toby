/**
 * Ledger repository: hand-written SQL over the domain database (db.ts
 * owns the connection and schema) — integer cents, local `YYYY-MM-DD`
 * dates, UTC `created_at`.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { LedgerDb } from "./db.ts";
import type {
  LedgerEntry,
  LedgerEntryPatch,
  LedgerTransactionRow,
} from "./types.ts";

/** The full row projection every read in this file returns. */
const TRANSACTION_COLUMNS_SQL =
  "SELECT id, date, type, category, amount, note, created_at FROM transactions";

/**
 * Patchable columns: domain field → column name, fixed by code (never
 * input). Typing the map as Record over every patch field makes
 * exhaustiveness a compile error: add a field to LedgerEntryPatch
 * without a column here and tsc fails — a field can never be silently
 * dropped from an UPDATE.
 */
const PATCH_COLUMNS: Record<keyof LedgerEntryPatch, string> = {
  date: "date",
  type: "type",
  category: "category",
  amount: "amount",
  note: "note",
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
  /**
   * Update one row's patched columns in a single transaction. The row is
   * read inside that same transaction, so the returned before/after pair
   * is one consistent snapshot; undefined when no row carries the id.
   */
  updateTransaction(
    id: number,
    patch: LedgerEntryPatch,
  ): Promise<
    { before: LedgerTransactionRow; after: LedgerTransactionRow } | undefined
  >;
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
            "INSERT INTO transactions (date, type, category, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [
              entry.date,
              entry.type,
              entry.category,
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
        "SELECT id, date, type, category, amount, note, created_at FROM transactions WHERE date >= ? AND date < ? ORDER BY date ASC, id ASC",
        [start, end],
      );
    },

    async listDayTransactions(date) {
      const handle = await db.open();
      return handle.query<LedgerTransactionRow>(
        "SELECT id, date, type, category, amount, note, created_at FROM transactions WHERE date = ? ORDER BY id ASC",
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

    async updateTransaction(id, patch) {
      // Column names come from the fixed PATCH_COLUMNS map (never from
      // input); values are parameterized. Only the patched columns join
      // the SET clause.
      const sets: string[] = [];
      const values: (string | number)[] = [];
      // Object.entries widens the keys to string; restore the patch-field
      // union so PATCH_COLUMNS stays exhaustively typed.
      const entries = Object.entries(patch) as [
        keyof LedgerEntryPatch,
        string | number | undefined,
      ][];
      for (const [field, value] of entries) {
        // Defensive: a key explicitly set to undefined never joins the SET.
        if (value !== undefined) {
          sets.push(`${PATCH_COLUMNS[field]} = ?`);
          values.push(value);
        }
      }
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [before] = await tx.query<LedgerTransactionRow>(
          `${TRANSACTION_COLUMNS_SQL} WHERE id = ?`,
          [id],
        );
        if (!before) {
          return undefined;
        }
        await tx.run(
          `UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`,
          [...values, id],
        );
        const [after] = await tx.query<LedgerTransactionRow>(
          `${TRANSACTION_COLUMNS_SQL} WHERE id = ?`,
          [id],
        );
        return after ? { before, after } : undefined;
      });
    },
  };
}
