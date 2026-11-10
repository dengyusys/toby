/**
 * Ledger domain client: typed access to the direct write path and the
 * month views. Mirrors the server's response shapes — amounts are integer
 * cents, dates are "YYYY-MM-DD" strings. Recording lands at once as one
 * validated transaction; the returned receipt is what landed.
 */

import { endpoint, requestJson } from "./request-json.ts";

export type LedgerEntryType = "income" | "expense";

export interface LedgerEntry {
  date: string;
  type: LedgerEntryType;
  category: string;
  account: string;
  amount: number;
  note: string;
}

/** The receipt of a direct write that has already landed. */
export interface LedgerReceiptView {
  written: number;
  transaction_ids: number[];
  entries: LedgerEntry[];
  created_at: string;
}

/** Result of a user-initiated delete (the sole non-card write). */
export interface LedgerDeleteResult {
  transaction_id: number;
  status: "deleted";
  deleted_at: string;
}

export interface LedgerTransactionRow extends LedgerEntry {
  id: number;
  created_at: string;
}

export interface LedgerCategorySummary {
  type: LedgerEntryType;
  category: string;
  total: number;
}

export interface LedgerMonthReport {
  month: string;
  transactions: LedgerTransactionRow[];
  income_total: number;
  expense_total: number;
  categories: LedgerCategorySummary[];
}

export interface LedgerClient {
  /** Delete one stored transaction by id; unknown ids 404. */
  deleteTransaction(id: number): Promise<LedgerDeleteResult>;
  /** Months that have records, descending. */
  listMonths(): Promise<string[]>;
  monthReport(month: string): Promise<LedgerMonthReport>;
}

export function createLedgerClient(baseUrl: string): LedgerClient {
  return {
    deleteTransaction: (id) =>
      requestJson<LedgerDeleteResult>(
        endpoint(baseUrl, `/api/ledger/transactions/${id}`),
        { method: "DELETE" },
      ),
    listMonths: async () => {
      const body = await requestJson<{ months: string[] }>(
        endpoint(baseUrl, "/api/ledger/months"),
      );
      return body.months;
    },
    monthReport: (month) =>
      requestJson<LedgerMonthReport>(
        endpoint(
          baseUrl,
          `/api/ledger/transactions?month=${encodeURIComponent(month)}`,
        ),
      ),
  };
}
