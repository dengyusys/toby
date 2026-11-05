/**
 * Ledger domain client: typed access to the immediate-tier write path and
 * the month views. Mirrors the server's response shapes — amounts are
 * integer cents, dates are "YYYY-MM-DD" strings. Recording lands at once;
 * the returned receipt is born confirmed and revertible until
 * `revert_until`.
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

/** Card statuses the ledger can emit: born confirmed, possibly reverted. */
export type LedgerReceiptStatus = "committed" | "reverted";

/** The born-confirmed receipt of a write that has already landed. */
export interface LedgerReceiptView {
  proposal_id: string;
  status: LedgerReceiptStatus;
  created_at: string;
  committed_at: string;
  /** Until when a revert may still undo the batch. */
  revert_until: string;
  reverted_at?: string;
  written: number;
  transaction_ids: number[];
  entries: LedgerEntry[];
}

/** Result of reverting a landed batch inside its window. */
export interface LedgerRevertResult {
  proposal_id: string;
  status: "reverted";
  reverted_at: string;
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
export type LedgerProposalResult = LedgerReceiptView | LedgerFollowUp;

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
  /** Lands the batch at once; the receipt is born confirmed. */
  createStructuredProposal(entry: LedgerEntryInput): Promise<LedgerReceiptView>;
  /** One-sentence AI path: a landed receipt, or a clarifying question. */
  createTextProposal(text: string): Promise<LedgerProposalResult>;
  /** Undo a landed batch inside its revert window; conflicts answer 409. */
  revertProposal(id: string): Promise<LedgerRevertResult>;
  /** Delete one stored transaction by id; unknown ids 404. */
  deleteTransaction(id: number): Promise<LedgerDeleteResult>;
  /** Months that have records, descending. */
  listMonths(): Promise<string[]>;
  monthReport(month: string): Promise<LedgerMonthReport>;
}

export function createLedgerClient(baseUrl: string): LedgerClient {
  return {
    createStructuredProposal: (entry) =>
      requestJson<LedgerReceiptView>(
        endpoint(baseUrl, "/api/ledger/proposals"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry }),
        },
      ),
    createTextProposal: (text) =>
      requestJson<LedgerProposalResult>(
        endpoint(baseUrl, "/api/ledger/proposals"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      ),
    revertProposal: (id) =>
      requestJson<LedgerRevertResult>(
        endpoint(
          baseUrl,
          `/api/ledger/proposals/${encodeURIComponent(id)}/revert`,
        ),
        { method: "POST" },
      ),
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
