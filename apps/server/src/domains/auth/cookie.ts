/**
 * The session cookie: its name and how to read it from a request —
 * shared by the controller (logout, session query) and the route guard.
 * Hand-rolled on purpose: one cookie, no attributes to parse;
 * @fastify/cookie would be a dependency for two calls.
 */

import type { FastifyRequest } from "fastify";

export const SESSION_COOKIE = "toby_session";

export function readSessionCookie(
  request: FastifyRequest,
  name: string = SESSION_COOKIE,
): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator).trim();
    if (key === name && separator > 0) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}
