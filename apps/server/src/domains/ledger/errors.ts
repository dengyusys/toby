/**
 * Ledger wire error codes — the closed union of every code this domain
 * puts on the HTTP envelope. Web clients match on these strings; add new
 * codes here and in the clients, nowhere else.
 */

export type LedgerErrorCode =
  "INVALID_ENTRY" | "INVALID_MONTH" | "AI_UNAVAILABLE" | "AI_REQUEST_FAILED";

/** Use-case failure (bad month, AI transport trouble, bad AI draft). */
export class LedgerRequestError extends Error {
  readonly code: LedgerErrorCode;
  readonly status: number;

  constructor(code: LedgerErrorCode, status: number, message: string) {
    super(message);
    this.name = "LedgerRequestError";
    this.code = code;
    this.status = status;
  }
}

/** Entry-shape/semantics rejection from the trust boundary (validation.ts). */
export class LedgerInputError extends Error {
  readonly code = "INVALID_ENTRY";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LedgerInputError";
  }
}
