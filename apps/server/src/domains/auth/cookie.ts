/**
 * The session cookie's name and its readers. The header is parsed by hand,
 * so nothing depends on a cookie decorator being present.
 *
 * Two readers, one deliberate asymmetry kept from the first server: the
 * session guard matches the raw header value (a quoted token is no token it
 * ever set, so it does not authenticate), while the session/logout routes
 * read the way cookie parsers always have (RFC 6265: a quoted value is the
 * value). Unifying them is a wire-contract change, not a refactor.
 */

export const SESSION_COOKIE = "toby_session";

/** The raw header value: what the guard matches tokens against. */
export function readSessionCookie(
  cookieHeader: string | undefined,
  name: string = SESSION_COOKIE,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator).trim();
    if (key === name && separator > 0) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** The parsed value: quotes stripped, what the auth endpoints answer for. */
export function readSessionCookieToken(
  cookieHeader: string | undefined,
): string | undefined {
  return unquoteCookieValue(readSessionCookie(cookieHeader));
}

/** RFC 6265: a sender may quote the value; a quoted token is the token. */
function unquoteCookieValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}
