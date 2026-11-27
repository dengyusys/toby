/**
 * Access vocabulary shared by the guard: who is calling, and the one rule a
 * route can add on top of "authenticated". Pure logic — no transport, no
 * infrastructure, no node: imports — so the rule is unit-tested without an
 * HTTP server.
 */

/** Who is calling, as the guard resolved it from the cookie or the header. */
export type Principal =
  | { readonly kind: "session" }
  | { readonly kind: "token"; readonly tokenId: string };

/**
 * A route's access rule, read from its route config. A route without it
 * takes any authenticated caller: the owner's session, or an access token.
 */
export interface AccessRule {
  /** Only a browser session may call this route; a token answers 403. */
  sessionOnly?: boolean;
}

/** Why a caller may not reach a route; undefined when it may. */
export type Denial = "session-required";

export function checkAccess(
  principal: Principal,
  rule: AccessRule | undefined,
): Denial | undefined {
  return rule?.sessionOnly === true && principal.kind !== "session"
    ? "session-required"
    : undefined;
}

/**
 * The credential in an `Authorization: Bearer <token>` header. Any other
 * scheme is not ours and answers undefined, so the cookie is consulted.
 */
export function readBearerToken(
  authorization: string | undefined,
): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }
  return /^bearer\s+(\S+)$/i.exec(authorization)?.[1];
}
