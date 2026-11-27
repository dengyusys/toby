/**
 * The access rules in isolation: the method default, the two tiers, the
 * session-only rule, the accepted scope sets, and the bearer header reader.
 */

import { describe, expect, it } from "vitest";
import {
  checkAccess,
  hasScope,
  isAllowedTokenScopes,
  readBearerToken,
  requiredScope,
} from "../../src/domains/auth/access.ts";

const session = { kind: "session" } as const;
const readOnly = {
  kind: "token",
  tokenId: "read-1",
  scopes: ["read"],
} as const;
const readWrite = {
  kind: "token",
  tokenId: "write-1",
  scopes: ["write"],
} as const;

describe("requiredScope", () => {
  it("defaults to read for looking and write for everything else", () => {
    expect(requiredScope(undefined, "GET")).toBe("read");
    expect(requiredScope(undefined, "HEAD")).toBe("read");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requiredScope(undefined, method)).toBe("write");
    }
  });

  it("a route's own scope wins over the method default", () => {
    expect(requiredScope({ scope: "write" }, "GET")).toBe("write");
    expect(requiredScope({ scope: "read" }, "POST")).toBe("read");
  });
});

describe("checkAccess", () => {
  it("a session passes every route, session-only included", () => {
    const rules = [
      undefined,
      { sessionOnly: true },
      { scope: "write" },
    ] as const;
    for (const rule of rules) {
      expect(checkAccess(session, rule, "GET")).toBeUndefined();
      expect(checkAccess(session, rule, "DELETE")).toBeUndefined();
    }
  });

  it("a read token looks but never changes", () => {
    expect(checkAccess(readOnly, undefined, "GET")).toBeUndefined();
    expect(checkAccess(readOnly, undefined, "POST")).toBe("insufficient-scope");
  });

  it("a write token covers both tiers", () => {
    expect(checkAccess(readWrite, undefined, "GET")).toBeUndefined();
    expect(checkAccess(readWrite, undefined, "POST")).toBeUndefined();
    expect(hasScope(readWrite, "read")).toBe(true);
  });

  it("a session-only route refuses every token, write included", () => {
    expect(checkAccess(readWrite, { sessionOnly: true }, "GET")).toBe(
      "session-required",
    );
    expect(checkAccess(readOnly, { sessionOnly: true }, "POST")).toBe(
      "session-required",
    );
  });
});

describe("isAllowedTokenScopes", () => {
  it("accepts exactly one tier and nothing else", () => {
    expect(isAllowedTokenScopes(["read"])).toBe(true);
    expect(isAllowedTokenScopes(["write"])).toBe(true);
    for (const scopes of [[], ["read", "write"], ["admin"], ["READ"]]) {
      expect(isAllowedTokenScopes(scopes)).toBe(false);
    }
  });
});

describe("readBearerToken", () => {
  it("reads the credential after a Bearer scheme, case-insensitive", () => {
    expect(readBearerToken("Bearer abc")).toBe("abc");
    expect(readBearerToken("bearer abc")).toBe("abc");
    expect(readBearerToken("BEARER   abc")).toBe("abc");
  });

  it("any other header is not ours", () => {
    expect(readBearerToken(undefined)).toBeUndefined();
    expect(readBearerToken("")).toBeUndefined();
    expect(readBearerToken("Basic abc")).toBeUndefined();
    expect(readBearerToken("Bearer")).toBeUndefined();
    expect(readBearerToken("Bearer a b")).toBeUndefined();
  });
});
