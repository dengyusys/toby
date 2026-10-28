/**
 * The server-wide error body: Nest's `statusCode` / `message` / `error` shape
 * plus `errorCode`, the stable code clients match on.
 */

import { HttpException } from "@nestjs/common";
import { STATUS_CODES } from "node:http";

/** Serialized body of every error the server writes. */
export interface ErrorBody {
  statusCode: number;
  message: string;
  /** Reason phrase of `statusCode`, as Nest's built-in exceptions emit it. */
  error: string;
  /** Stable, client-matchable code from the throwing domain's closed union. */
  errorCode: string;
}

/** The error body, in Nest's own shape plus `errorCode`. */
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

/** A throwable carrying the error body above. */
export function createHttpError(
  statusCode: number,
  errorCode: string,
  message: string,
): HttpException {
  return new HttpException(
    createErrorBody(statusCode, errorCode, message),
    statusCode,
  );
}

/**
 * Base of every domain failure: an `HttpException` whose body is already the
 * error body, so the filter passes it through untouched.
 */
export class DomainHttpError extends HttpException {
  /** Mirror of the body's `errorCode`, for logs and callers. */
  readonly code: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(createErrorBody(statusCode, errorCode, message), statusCode);
    this.code = errorCode;
    // HttpException derives `message` from the body; restate it.
    this.message = message;
  }
}
