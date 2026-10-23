/**
 * Auth wire error codes — the closed union of every code this domain puts
 * on the HTTP envelope. Web clients match on these strings; add new codes
 * here and in the clients, nowhere else.
 */

export type AuthErrorCode =
  "AUTH_DISABLED" | "RATE_LIMITED" | "INVALID_CREDENTIALS" | "AUTH_REQUIRED";

/** Login/guard failure; optionally carries a Retry-After hint (429). */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AuthErrorCode,
    status: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
