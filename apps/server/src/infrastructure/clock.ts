/**
 * The injectable clock: everything that reads time goes through it, so tests
 * can pin or drive the current millisecond instant.
 */

/** Milliseconds since the epoch, as `Date.now()` reports it. */
export type Clock = () => number;
