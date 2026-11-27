/**
 * Access vocabulary shared by the guard and the token store: who is calling
 * and what they may do. Pure logic — no transport, no infrastructure, no
 * node: imports — so the rules are unit-tested without an HTTP server.
 */

/** What a credential may do; `write` covers `read`. */
export type Scope = "read" | "write";

/** Who is calling, as the guard resolved it from the cookie or the header. */
export type Principal =
  | { readonly kind: "session" }
  | {
      readonly kind: "token";
      readonly tokenId: string;
      readonly scopes: readonly Scope[];
    };

/**
 * A route's access rule, read from its route config. A route with neither
 * field takes the default: any session, or a token with enough scope.
 */
export interface AccessRule {
  /** Only a browser session may call this route; a token answers 403. */
  sessionOnly?: boolean;
  /** Overrides the method default of `requiredScope`. */
  scope?: Scope;
}

/**
 * The scope a method needs when the route says nothing: looking is `read`,
 * anything that can change something is `write`. The default is what makes
 * a new route covered the moment it lands.
 */
export function requiredScope(
  rule: AccessRule | undefined,
  method: string,
): Scope {
  return (
    rule?.scope ?? (method === "GET" || method === "HEAD" ? "read" : "write")
  );
}

export function hasScope(principal: Principal, scope: Scope): boolean {
  if (principal.kind === "session") {
    return true;
  }
  return principal.scopes.includes("write") || principal.scopes.includes(scope);
}

/** Why a caller may not reach a route; undefined when it may. */
export type Denial = "session-required" | "insufficient-scope";

/** Session-only is judged first: a `write` token is still a token. */
export function checkAccess(
  principal: Principal,
  rule: AccessRule | undefined,
  method: string,
): Denial | undefined {
  if (rule?.sessionOnly === true && principal.kind !== "session") {
    return "session-required";
  }
  return hasScope(principal, requiredScope(rule, method))
    ? undefined
    : "insufficient-scope";
}

/**
 * The only scope sets a token can be created with: exactly one of the two
 * tiers. A list, so finer scopes can join later without a new field — and
 * nothing outside it is accepted today.
 */
const TOKEN_TIERS: readonly string[] = ["read", "write"];

export function isAllowedTokenScopes(scopes: readonly string[]): boolean {
  return scopes.length === 1 && TOKEN_TIERS.includes(scopes[0]!);
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
