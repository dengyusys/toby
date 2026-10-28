/**
 * The session cookie's name and its reader. A guard runs before parameter
 * decorators, so it reads the header itself instead of using `@Cookies()`.
 */

import type { NodeRequest } from "@nestjs/platform-node";

export const SESSION_COOKIE = "toby_session";

export function readSessionCookie(
  request: NodeRequest,
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
