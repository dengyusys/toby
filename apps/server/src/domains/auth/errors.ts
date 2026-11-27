/** The domain's closed wire-code union: clients match these, never messages. */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "AUTH_REQUIRED"
  | "ALREADY_REGISTERED"
  | "REGISTRATION_CLOSED"
  | "INVALID_TOKEN"
  | "SESSION_REQUIRED"
  | "TOKEN_NOT_FOUND";

/** Login, registration, guard and token failure. */
export class AuthError extends DomainHttpError {
  constructor(code: AuthErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "AuthError";
  }
}
