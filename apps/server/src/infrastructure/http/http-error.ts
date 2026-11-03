/**
 * The server-wide error body: `{ statusCode, message, error }` — the one
 * shape the API has always answered — plus `errorCode`, the stable code
 * clients match on.
 */

import { STATUS_CODES } from "node:http";

/** Serialized body of every error the server writes. */
export interface ErrorBody {
  statusCode: number;
  message: string;
  /** Reason phrase of `statusCode`. */
  error: string;
  /** Stable, client-matchable code from the throwing domain's closed union. */
  errorCode: string;
}

/**
 * Codes the HTTP shell itself answers with (unmatched routes, body parsing,
 * envelope validation, limits): the historic status names, with 404 always
 * PAGE_NOT_FOUND. Domain failures use their own closed unions in
 * `domains/<domain>/errors.ts`.
 */
export type FrameworkErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "PAYMENT_REQUIRED"
  | "FORBIDDEN"
  | "PAGE_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "NOT_ACCEPTABLE"
  | "PROXY_AUTHENTICATION_REQUIRED"
  | "REQUEST_TIMEOUT"
  | "CONFLICT"
  | "GONE"
  | "LENGTH_REQUIRED"
  | "PRECONDITION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "URI_TOO_LONG"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "REQUESTED_RANGE_NOT_SATISFIABLE"
  | "EXPECTATION_FAILED"
  | "I_AM_A_TEAPOT"
  | "MISDIRECTED"
  | "UNPROCESSABLE_ENTITY"
  | "LOCKED"
  | "FAILED_DEPENDENCY"
  | "PRECONDITION_REQUIRED"
  | "TOO_MANY_REQUESTS"
  | "HTTP_ERROR";

/** The error body with the stable `errorCode` attached. */
export function createErrorBody(
  statusCode: number,
  errorCode: string,
  message: string,
): ErrorBody {
  return {
    statusCode,
    message,
    error: STATUS_CODES[statusCode] ?? "Error",
    errorCode,
  };
}

/**
 * Base of every deliberate failure the server throws: a plain error whose
 * body is already the shared error body, so the HTTP error boundary passes
 * it through untouched.
 */
export class DomainHttpError extends Error {
  readonly statusCode: number;
  /** Mirror of the body's `errorCode`, for logs and callers. */
  readonly code: string;
  /** What the error boundary sends. */
  readonly body: ErrorBody;

  constructor(statusCode: number, errorCode: string, message: string) {
    // A deliberate failure always answers an error status; anything else
    // is a programming error and surfaces as the sanitized 500.
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError(`not an error status: ${statusCode}`);
    }
    super(message);
    this.name = "DomainHttpError";
    this.statusCode = statusCode;
    this.code = errorCode;
    this.body = createErrorBody(statusCode, errorCode, message);
  }
}
