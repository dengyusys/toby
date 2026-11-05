/** The domain's closed wire-code union: clients match these, never messages. */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type ChatErrorCode =
  | "INVALID_TEXT"
  | "SESSION_NOT_FOUND"
  | "TURN_NOT_FOUND"
  | "AI_UNAVAILABLE"
  | "AI_REQUEST_FAILED"
  | "RATE_LIMITED";

/** Use-case failure (bad input, unknown session, AI transport trouble). */
export class ChatRequestError extends DomainHttpError {
  constructor(code: ChatErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "ChatRequestError";
  }
}
