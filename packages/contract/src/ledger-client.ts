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

/** Input for the structured single-entry path; amount is pre-cents. */
export interface LedgerEntryInput {
  date: string;
  type: LedgerEntryType;
  category: string;
  account: string;
  /** Non-negative number with at most two decimals, as typed. */
  amount: string | number;
  note?: string;
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

/** The AI could not resolve the sentence: it asks the user one question. */
export interface LedgerFollowUp {
  question: string;
}

/** A landed receipt, or the AI asking for clarification. */
export type LedgerWriteResult = LedgerReceiptView | LedgerFollowUp;

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
  /** Lands the single structured entry at once. */
  writeStructuredEntry(entry: LedgerEntryInput): Promise<LedgerReceiptView>;
  /** One-sentence AI path: a landed receipt, or a clarifying question. */
  writeFromText(text: string): Promise<LedgerWriteResult>;
  /** Delete one stored transaction by id; unknown ids 404. */
  deleteTransaction(id: number): Promise<LedgerDeleteResult>;
  /** Months that have records, descending. */
  listMonths(): Promise<string[]>;
  monthReport(month: string): Promise<LedgerMonthReport>;
}

export function createLedgerClient(baseUrl: string): LedgerClient {
  return {
    writeStructuredEntry: (entry) =>
      requestJson<LedgerReceiptView>(endpoint(baseUrl, "/api/ledger/entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry }),
      }),
    writeFromText: (text) =>
      requestJson<LedgerWriteResult>(endpoint(baseUrl, "/api/ledger/entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }),
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
