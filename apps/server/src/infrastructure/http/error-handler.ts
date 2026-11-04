/**
 * The single error boundary: a `DomainHttpError` passes through as built,
 * a framework error that already carries a 4xx status (body-parser limits,
 * undecodable JSON, bad URL components) is rebuilt with a code derived from
 * its status, and everything else answers the sanitized 500 — nothing of
 * the stack goes out, only one error line in the request log.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  DomainHttpError,
  createErrorBody,
  type FrameworkErrorCode,
} from "./http-error.ts";

/** Wire codes for 4xx statuses the framework itself can produce. */
const STATUS_ERROR_CODES: Partial<Record<number, FrameworkErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  402: "PAYMENT_REQUIRED",
  403: "FORBIDDEN",
  404: "PAGE_NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  407: "PROXY_AUTHENTICATION_REQUIRED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  410: "GONE",
  411: "LENGTH_REQUIRED",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  414: "URI_TOO_LONG",
  415: "UNSUPPORTED_MEDIA_TYPE",
  416: "REQUESTED_RANGE_NOT_SATISFIABLE",
  417: "EXPECTATION_FAILED",
  418: "I_AM_A_TEAPOT",
  421: "MISDIRECTED",
  422: "UNPROCESSABLE_ENTITY",
  423: "LOCKED",
  424: "FAILED_DEPENDENCY",
  428: "PRECONDITION_REQUIRED",
  429: "TOO_MANY_REQUESTS",
};

/** `400` → `"BAD_REQUEST"`, used when nothing better fits. */
function statusCodeName(status: number): FrameworkErrorCode {
  return STATUS_ERROR_CODES[status] ?? "HTTP_ERROR";
}

/** A real 4xx status: framework errors carry one; anything else is a bug. */
function isClientErrorStatus(status: unknown): status is number {
  return (
    Number.isInteger(status) &&
    (status as number) >= 400 &&
    (status as number) < 500
  );
}

export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof DomainHttpError) {
    reply.status(error.statusCode).send(error.body);
    return;
  }

  // A Content-Type that is not even type/subtype never reaches the
  // catch-all body parser; the first server dropped such requests and let
  // the envelope answer, so Fastify's 415 maps back to that 400.
  if (
    (error as FastifyError | null)?.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
  ) {
    reply
      .status(400)
      .send(
        createErrorBody(
          400,
          "BAD_REQUEST",
          error instanceof Error && error.message
            ? error.message
            : "malformed request",
        ),
      );
    return;
  }

  // Fastify's own rejects (over-limit bodies, malformed JSON, bad URL
  // components) carry their status on the error.
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (isClientErrorStatus(status)) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "malformed request";
    reply
      .status(status)
      .send(createErrorBody(status, statusCodeName(status), message));
    return;
  }

  // Unexpected: one line in the request log, correlated with the request
  // lines by the request id — the stack only, never the error object
  // (driver errors carry SQL text, hosts and users in their properties and
  // causes). The sanitized body deliberately keeps the historic
  // `{ statusCode, message }` shape without `error` / `errorCode`; it is
  // part of the wire contract, do not unify it.
  request.log.error(
    {
      stack:
        error instanceof Error
          ? (error.stack ?? `${error.name}: ${error.message}`)
          : String(error),
    },
    "unhandled error",
  );
  reply.status(500).send({ statusCode: 500, message: "Internal server error" });
}

/**
 * Router-level rejects (an undecodable URL component such as `/%zz`) never
 * reach a route, its hooks or the error handler, so they answer here — same
 * body, and the no-store header the route hooks would have added.
 */
export function frameworkErrorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const status = isClientErrorStatus(error.statusCode) ? error.statusCode : 400;
  reply
    .status(status)
    .header("Cache-Control", "no-store")
    .send(createErrorBody(status, statusCodeName(status), error.message));
}
