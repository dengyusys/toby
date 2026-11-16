/**
 * Ledger query-cache keys — a per-app copy (the sibling app mirrors it),
 * the keys-side sibling of ledger-view.ts. The month key is the
 * load-bearing one: the calendar (ledger-hooks) and the month preview
 * panel use the same key to share one cache entry, and the write hooks
 * invalidate the shared root — a key that drifts silently splits the
 * cache or breaks invalidation.
 */

/** Ledger queries: the month list and per-month reports. */
export const ledgerQueryKeys = {
  /** Root of every ledger key: invalidate to refetch them all. */
  all: ["ledger"] as const,
  /** The month list the calendar navigates by. */
  months: ["ledger", "months"] as const,
  /** One month's report; a null month means none chosen yet (query
   * disabled), and the null still participates in the key. */
  month: (month: string | null) => ["ledger", "month", month] as const,
};
