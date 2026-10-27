/**
 * Unified error boundary as a Nest filter: the { error: { code, message } }
 * envelope for every failure that can leave the server. Mapping order:
 *   1. Fastify body-parse errors: oversized 413, invalid/empty JSON 400;
 *   2. Not-found: 405 when the path exists under another method, else 404;
 *   3. Domain-shaped errors (Error + code + status): their own envelope;
 *   4. Fallback: full stack stays in server logs, sanitized 500 out.
 */

import {
  Catch,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HTTP_STATUS, createErrorResponse } from "./contract.ts";
import { sendJsonReply } from "./response.ts";

// Recognized structurally (Error + code + status) so this layer never
// imports any domain class.
type DomainHttpError = Error & { code: string; status: number };

function isDomainHttpError(error: unknown): error is DomainHttpError {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return typeof code === "string" && typeof status === "number";
}

function decodePathname(url: string): string {
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  try {
    return decodeURIComponent(pathname);
  } catch {
    // Undecodable percent sequences never match a real route; fall back
    // to the raw pathname so the answer stays the 404 envelope.
    return pathname;
  }
}

@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  constructor(private readonly instance: FastifyInstance) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const error = exception as Error & { code?: string };

    if (error?.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      this.replyBodyTooLarge(reply);
    } else if (
      error?.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      error?.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
    ) {
      this.replyInvalidJson(
        reply,
        error.code === "FST_ERR_CTP_EMPTY_JSON_BODY",
      );
    } else if (exception instanceof NotFoundException) {
      this.replyRouteMismatch(reply, request);
    } else if (isDomainHttpError(error)) {
      this.replyDomainError(reply, error);
    } else {
      this.replyUnexpected(reply, request, error);
    }
  }

  private replyBodyTooLarge(reply: FastifyReply): void {
    sendJsonReply(
      reply,
      HTTP_STATUS.payloadTooLarge,
      createErrorResponse(
        "PAYLOAD_TOO_LARGE",
        "request body exceeds the limit",
      ),
    );
  }

  private replyInvalidJson(reply: FastifyReply, emptyBody: boolean): void {
    sendJsonReply(
      reply,
      HTTP_STATUS.badRequest,
      createErrorResponse(
        "INVALID_JSON",
        emptyBody
          ? "request body must be a JSON object"
          : "request body is not valid JSON",
      ),
    );
  }

  // Nest's default not-found handler throws NotFoundException; a path
  // that exists under another method is a 405, everything else is the
  // 404 envelope. The router matches on the decoded path, so the probe
  // decodes too — an encoded variant of a known path must discriminate
  // the same way the route itself did.
  private replyRouteMismatch(
    reply: FastifyReply,
    request: FastifyRequest,
  ): void {
    const pathname = decodePathname(request.url);
    const mismatched = (this.instance.supportedMethods ?? []).some(
      (candidate) =>
        candidate !== request.method &&
        this.instance.hasRoute({ method: candidate, url: pathname }),
    );
    if (mismatched) {
      sendJsonReply(
        reply,
        HTTP_STATUS.methodNotAllowed,
        createErrorResponse("METHOD_NOT_ALLOWED", "method not allowed"),
      );
      return;
    }
    sendJsonReply(
      reply,
      HTTP_STATUS.notFound,
      createErrorResponse("PAGE_NOT_FOUND", "page not found"),
    );
  }

  private replyDomainError(reply: FastifyReply, error: DomainHttpError): void {
    sendJsonReply(
      reply,
      error.status,
      createErrorResponse(error.code, error.message),
    );
  }

  // Unexpected exception: sanitized 500 out, full stack in the server log.
  private replyUnexpected(
    reply: FastifyReply,
    request: FastifyRequest,
    error: unknown,
  ): void {
    request.log?.error?.({ err: error, url: request.url }, "unexpected error");
    sendJsonReply(
      reply,
      HTTP_STATUS.internalServerError,
      createErrorResponse("INTERNAL_ERROR", "internal server error"),
    );
  }
}
