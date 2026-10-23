/**
 * Ledger domain types: the pure vocabulary shared by validation, the
 * proposal registry, the store and the controller. Amounts are integer cents
 * end to end; dates are local "YYYY-MM-DD" strings; timestamps are UTC ISO
 * strings.
 */

/** Direction of money movement. */
export type LedgerEntryType = "income" | "expense";

/** One normalized transaction, ready to store. */
export interface LedgerEntry {
  readonly date: string;
  readonly type: LedgerEntryType;
  readonly category: string;
  readonly account: string;
  /** Integer cents, non-negative (0 is a valid amount). */
  readonly amount: number;
  readonly note: string;
}

/** A stored transaction: identity and creation time added. */
export interface LedgerTransactionRow extends LedgerEntry {
  readonly id: number;
  readonly created_at: string;
}

/**
 * Mirrors the actions kernel's ActionStatus value for value; kept literal
 * here so this file stays free of infrastructure imports.
 */
export type LedgerProposalStatus =
  "pending" | "committed" | "cancelled" | "expired";

/** The client-facing proposal card. */
export interface LedgerProposalView {
  readonly proposal_id: string;
  readonly status: LedgerProposalStatus;
  readonly created_at: string;
  readonly auto_write_at: string;
  readonly expires_at: string;
  readonly entries: readonly LedgerEntry[];
}

/** Result of a committed proposal, echoed unchanged on idempotent re-commit. */
export interface LedgerCommitResult {
  readonly proposal_id: string;
  readonly status: "committed";
  readonly written: number;
  readonly transaction_ids: readonly number[];
  readonly committed_at: string;
}

export interface LedgerCancelResult {
  readonly proposal_id: string;
  readonly status: "cancelled";
}

/** Category subtotal inside a month report. */
export interface LedgerCategorySummary {
  readonly type: LedgerEntryType;
  readonly category: string;
  readonly total: number;
}

export interface LedgerMonthReport {
  readonly month: string;
  readonly transactions: readonly LedgerTransactionRow[];
  readonly income_total: number;
  readonly expense_total: number;
  readonly categories: readonly LedgerCategorySummary[];
}
