/**
 * Ledger domain client: typed access to the proposal pipeline and the month
 * views. Mirrors the server's response shapes — amounts are integer cents,
 * dates are "YYYY-MM-DD" strings.
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

export type LedgerProposalStatus =
  "pending" | "committed" | "cancelled" | "expired";

export interface LedgerProposalView {
  proposal_id: string;
  status: LedgerProposalStatus;
  created_at: string;
  auto_write_at: string;
  expires_at: string;
  entries: LedgerEntry[];
}

export interface LedgerCommitResult {
  proposal_id: string;
  status: "committed";
  written: number;
  transaction_ids: number[];
  committed_at: string;
}

export interface LedgerCancelResult {
  proposal_id: string;
  status: "cancelled";
}

/** Result of a user-initiated delete (the sole non-proposal write). */
export interface LedgerDeleteResult {
  transaction_id: number;
  status: "deleted";
  deleted_at: string;
}

/** The AI could not resolve the sentence: it asks the user one question. */
export interface LedgerFollowUp {
  question: string;
}

/** A proposal, or the AI asking for clarification. */
export type LedgerProposalResult = LedgerProposalView | LedgerFollowUp;

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
  createStructuredProposal(
    entry: LedgerEntryInput,
  ): Promise<LedgerProposalView>;
  /** One-sentence AI path: a proposal, or a clarifying question. */
  createTextProposal(text: string): Promise<LedgerProposalResult>;
  commitProposal(id: string): Promise<LedgerCommitResult>;
  cancelProposal(id: string): Promise<LedgerCancelResult>;
  /** Delete one stored transaction by id; unknown ids 404. */
  deleteTransaction(id: number): Promise<LedgerDeleteResult>;
  /** Months that have records, descending. */
  listMonths(): Promise<string[]>;
  monthReport(month: string): Promise<LedgerMonthReport>;
}

export function createLedgerClient(baseUrl: string): LedgerClient {
  return {
    createStructuredProposal: (entry) =>
      requestJson<LedgerProposalView>(
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
    commitProposal: (id) =>
      requestJson<LedgerCommitResult>(
        endpoint(
          baseUrl,
          `/api/ledger/proposals/${encodeURIComponent(id)}/commit`,
        ),
        { method: "POST" },
      ),
    cancelProposal: (id) =>
      requestJson<LedgerCancelResult>(
        endpoint(
          baseUrl,
          `/api/ledger/proposals/${encodeURIComponent(id)}/cancel`,
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
