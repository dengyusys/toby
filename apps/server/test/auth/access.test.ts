/**
 * The access rule in isolation: a session passes every route, a token passes
 * every route but a session-only one, and the bearer header is read.
 */

import { describe, expect, it } from "vitest";
import { checkAccess, readBearerToken } from "../../src/domains/auth/access.ts";

const session = { kind: "session" } as const;
const token = { kind: "token", tokenId: "token-1" } as const;

describe("checkAccess", () => {
  it("a session passes every route, session-only included", () => {
    expect(checkAccess(session, undefined)).toBeUndefined();
    expect(checkAccess(session, {})).toBeUndefined();
    expect(checkAccess(session, { sessionOnly: true })).toBeUndefined();
  });

  it("a token passes every route but a session-only one", () => {
    expect(checkAccess(token, undefined)).toBeUndefined();
    expect(checkAccess(token, {})).toBeUndefined();
    expect(checkAccess(token, { sessionOnly: false })).toBeUndefined();
    expect(checkAccess(token, { sessionOnly: true })).toBe("session-required");
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
