/**
 * Unified error handler: maps every exception back to the public envelope
 * { error: { code, message } } with stable status codes.
 *
 * Domain errors are recognized structurally (Error + string code + numeric
 * status), so infrastructure never imports any domain error class.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { HTTP_STATUS, createErrorResponse } from "./contract.ts";
import { sendJsonReply } from "./response.ts";

// Common shape of domain business errors: Error plus code and status.
type DomainHttpError = Error & { code: string; status: number };

function isDomainHttpError(error: unknown): error is DomainHttpError {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return typeof code === "string" && typeof status === "number";
}

/**
 * Register the unified error boundary. Mapping order:
 *   1. Fastify body-parse errors: oversized 413, invalid/empty JSON 400;
 *   2. Domain-shaped errors (Error + code + status): envelope with their own values;
 *   3. Fallback: full stack stays in server logs, the client gets a sanitized 500.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: Error & { code?: string }, request, reply: FastifyReply) => {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        sendJsonReply(
          reply,
          HTTP_STATUS.payloadTooLarge,
          createErrorResponse(
            "PAYLOAD_TOO_LARGE",
            "request body exceeds the limit",
          ),
        );
        return;
      }
      if (
        error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
        error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
      ) {
        sendJsonReply(
          reply,
          HTTP_STATUS.badRequest,
          createErrorResponse(
            "INVALID_JSON",
            error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
              ? "request body must be a JSON object"
              : "request body is not valid JSON",
          ),
        );
        return;
      }
      if (isDomainHttpError(error)) {
        sendJsonReply(
          reply,
          error.status,
          createErrorResponse(error.code, error.message),
        );
        return;
      }
      // Unexpected exception: sanitized 500 out, full stack in the server log.
      request.log.error({ err: error, url: request.url }, "unexpected error");
      sendJsonReply(
        reply,
        HTTP_STATUS.internalServerError,
        createErrorResponse("INTERNAL_ERROR", "internal server error"),
      );
    },
  );
}
