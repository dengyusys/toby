/**
 * Public HTTP contract: the canonical status codes and the isomorphic error
 * envelope { error: { code, message } }. This file is the single source of
 * truth for response shapes shared by the server routes and tests.
 */

export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  conflict: 409,
  gone: 410,
  notFound: 404,
  methodNotAllowed: 405,
  payloadTooLarge: 413,
  notImplemented: 501,
  internalServerError: 500,
} as const;

export interface ErrorEnvelope {
  error: { code: string; message: string };
}

export function createErrorResponse(
  code: string,
  message: string,
): ErrorEnvelope {
  return { error: { code, message } };
}
