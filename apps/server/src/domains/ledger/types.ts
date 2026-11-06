/**
 * Ledger domain types: the pure vocabulary shared by validation, the
 * proposal registry, the repository and the routes. Amounts are integer cents
 * end to end; dates are local "YYYY-MM-DD" strings; timestamps are UTC ISO
 * strings. Response shapes are mirrored by hand in
 * packages/contract/src/ledger-client.ts — change both sides together.
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
 * The card statuses the ledger can emit: immediate-tier writes are born
 * confirmed (docs/decisions/write-confirmation-tiers.md) and may later be
 * reverted inside their window. Kept literal here so this file stays free
 * of infrastructure imports.
 */
export type LedgerReceiptStatus = "committed" | "reverted";

/**
 * The born-confirmed receipt of an immediate-tier write: the batch has
 * already landed when this shape is returned; the revert window is the
 * only remaining interaction.
 */
export interface LedgerReceiptView {
  readonly proposal_id: string;
  readonly status: LedgerReceiptStatus;
  readonly created_at: string;
  readonly committed_at: string;
  /** Until when a revert may still apply the before-snapshot. */
  readonly revert_until: string;
  readonly reverted_at?: string;
  readonly written: number;
  readonly transaction_ids: readonly number[];
  readonly entries: readonly LedgerEntry[];
}

/** Result of reverting an immediate-tier write inside its window. */
export interface LedgerRevertResult {
  readonly proposal_id: string;
  readonly status: "reverted";
  readonly reverted_at: string;
}

/**
 * Result of a user-initiated delete — the domain's sole write outside the
 * AI card path (the explicit UI confirmation stands in for the
 * user-confirmation stage).
 */
export interface LedgerDeleteResult {
  readonly transaction_id: number;
  readonly status: "deleted";
  readonly deleted_at: string;
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

export interface LedgerDayReport {
  readonly date: string;
  readonly transactions: readonly LedgerTransactionRow[];
  readonly income_total: number;
  readonly expense_total: number;
  readonly categories: readonly LedgerCategorySummary[];
}
