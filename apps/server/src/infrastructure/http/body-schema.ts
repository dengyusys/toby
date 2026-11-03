/**
 * Body validation: one helper every route shares. The envelope is checked
 * here against a zod schema (the same library the AI tool contracts use);
 * everything inside the envelope stays the domain's call. A request that
 * carries no body at all is validated as `undefined`, so a route that needs
 * a body rejects it with a 400.
 */

import type { FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { DomainHttpError, type FrameworkErrorCode } from "./http-error.ts";

/** `path: message` per issue, one string per body — never an array. */
function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  return issue.path.length > 0
    ? `${issue.path.map(String).join(".")}: ${issue.message}`
    : issue.message;
}

/** Parses `request.body` against the route's schema. */
export function parseBody<T>(schema: ZodType<T>, request: FastifyRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw new DomainHttpError(
      400,
      "BAD_REQUEST" satisfies FrameworkErrorCode,
      result.error.issues.map(formatIssue).join("; "),
    );
  }
  return result.data;
}
