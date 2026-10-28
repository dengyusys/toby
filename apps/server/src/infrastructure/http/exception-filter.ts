/**
 * The single error boundary: not-found answers PAGE_NOT_FOUND, a body a
 * component built with an `errorCode` passes through as built, any other
 * `HttpException` is rebuilt with a code derived from its status, and
 * everything else goes to `BaseExceptionFilter`'s sanitized 500.
 */

import {
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  type ArgumentsHost,
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { createHttpError } from "./http-error.ts";

/** `HttpStatus[400]` → `"BAD_REQUEST"`, used when nothing better fits. */
function statusCodeName(status: number): string {
  return (
    (HttpStatus as unknown as Record<number, string>)[status] ?? "HTTP_ERROR"
  );
}

/**
 * The human message of an `HttpException` body of any shape. Nest's pipes
 * report validation issues as a `message` array, so flatten rather than drop.
 */
function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === "string") {
    return body;
  }
  const message = Array.isArray(body)
    ? body
    : (body as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.map(String).join("; ");
  }
  return typeof message === "string" ? message : exception.message;
}

/**
 * Whether the body stands as built: it carries an `errorCode`, or it does not
 * echo an HTTP status. Nest's `{ statusCode, message }` bodies get a code.
 */
function isDeliberateBody(exception: HttpException): boolean {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  if (typeof (body as { errorCode?: unknown }).errorCode === "string") {
    return true;
  }
  return (body as { statusCode?: unknown }).statusCode === undefined;
}

@Catch()
@Injectable()
export class HttpExceptionFilter extends BaseExceptionFilter {
  constructor(host: HttpAdapterHost) {
    super(host.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(this.normalize(exception), host);
      return;
    }

    // Unexpected: the base filter answers the sanitized 500 and reports it
    // itself.
    super.catch(exception, host);
  }

  /** Gives every `HttpException` the shared body; the domain's own stands. */
  private normalize(exception: HttpException): HttpException {
    if (exception instanceof NotFoundException) {
      return createHttpError(
        HttpStatus.NOT_FOUND,
        "PAGE_NOT_FOUND",
        "page not found",
      );
    }
    if (isDeliberateBody(exception)) {
      return exception;
    }
    const status = exception.getStatus();
    return createHttpError(
      status,
      statusCodeName(status),
      messageOf(exception),
    );
  }
}
