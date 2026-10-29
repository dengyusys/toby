/** The domain's closed wire-code union: clients match these, never messages. */

import { HttpStatus } from "@nestjs/common";
import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type LedgerErrorCode =
  | "INVALID_ENTRY"
  | "INVALID_MONTH"
  | "TRANSACTION_NOT_FOUND"
  | "AI_UNAVAILABLE"
  | "AI_REQUEST_FAILED";

/** Use-case failure (bad month, AI transport trouble, bad AI draft). */
export class LedgerRequestError extends DomainHttpError {
  constructor(code: LedgerErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "LedgerRequestError";
  }
}

/** Entry-shape/semantics rejection from the trust boundary (validation.ts). */
export class LedgerInputError extends DomainHttpError {
  constructor(message: string) {
    super(HttpStatus.BAD_REQUEST, "INVALID_ENTRY", message);
    this.name = "LedgerInputError";
  }
}
