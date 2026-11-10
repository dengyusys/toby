/**
 * Ledger domain types: the pure vocabulary shared by validation, the
 * repository and the routes. Amounts are integer cents end to end; dates
 * are local "YYYY-MM-DD" strings; timestamps are UTC ISO strings. Response
 * shapes are mirrored by hand in packages/contract/src/ledger-client.ts —
 * change both sides together.
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
 * The receipt of a direct write: the batch has already landed when this
 * shape is returned. There is no revert window — recovery is writing again
 * or backup.
 */
export interface LedgerReceiptView {
  readonly written: number;
  readonly transaction_ids: readonly number[];
  readonly entries: readonly LedgerEntry[];
  readonly created_at: string;
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
