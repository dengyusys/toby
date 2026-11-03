/**
 * The one not-found answer: every unmatched route — wrong path, wrong
 * method, a static file that is not there — gets the shared PAGE_NOT_FOUND
 * body.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorBody, type FrameworkErrorCode } from "./http-error.ts";

export function notFoundHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply
    .status(404)
    .send(
      createErrorBody(
        404,
        "PAGE_NOT_FOUND" satisfies FrameworkErrorCode,
        "page not found",
      ),
    );
}
