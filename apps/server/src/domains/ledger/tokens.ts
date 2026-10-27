/**
 * Ledger domain injection tokens for value-shaped or optional dependencies
 * that have no class to inject by type: the optional AI extractor (absent
 * while TOBY_AI_MODEL is unset) and the test-overridable proposal timing
 * knobs.
 */

export const LEDGER_EXTRACTOR = Symbol("LEDGER_EXTRACTOR");
export const LEDGER_TIMING = Symbol("LEDGER_TIMING");
