/**
 * Public HTTP contract: the canonical status codes and the isomorphic error
 * envelope { error: { code, message } }. This file is the single source of
 * truth for response shapes shared by the server routes and tests.
 */

export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  conflict: 409,
  gone: 410,
  notFound: 404,
  methodNotAllowed: 405,
  payloadTooLarge: 413,
  tooManyRequests: 429,
  notImplemented: 501,
  badGateway: 502,
  internalServerError: 500,
} as const;

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

/**
 * Root-level request gating signature shared by the auth domain (which
 * builds the guard) and the HTTP assembly (which installs it). Lives in
 * the neutral contract file so neither side imports assembly internals.
 */
export type RequestGuardFn = (
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) => Promise<void>;

export function createErrorResponse(
  code: string,
  message: string,
): ErrorEnvelope {
  return { error: { code, message } };
}
