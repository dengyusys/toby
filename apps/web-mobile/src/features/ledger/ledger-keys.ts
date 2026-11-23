/**
 * Ledger query-cache keys. The month key is load-bearing: the calendar and
 * the month preview share one cache entry, and the write hooks invalidate
 * the shared root — a key that drifts silently splits the cache or breaks
 * invalidation.
 */

export const ledgerQueryKeys = {
  all: ["ledger"] as const,
  months: ["ledger", "months"] as const,
  /** A null month means none chosen yet (query disabled) and still participates in the key. */
  month: (month: string | null) => ["ledger", "month", month] as const,
};
