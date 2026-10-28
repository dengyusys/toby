/** The domain's closed wire-code union: clients match these, never messages. */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type AuthErrorCode =
  "AUTH_DISABLED" | "INVALID_CREDENTIALS" | "AUTH_REQUIRED";

/** Login/guard failure. */
export class AuthError extends DomainHttpError {
  constructor(code: AuthErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "AuthError";
  }
}
