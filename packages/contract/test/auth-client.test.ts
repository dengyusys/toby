/**
 * Auth client against a stubbed fetch: request paths, bodies, and the
 * error-envelope mapping. The session token lives in an HttpOnly cookie —
 * the client neither reads nor returns it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createAuthClient } from "../src/index.ts";

function stubFetch(status: number, body: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAuthClient", () => {
  it("register posts the password to /api/auth/register", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createAuthClient("http://127.0.0.1:8629/");
    expect(await client.register("hunter2hunter2")).toEqual({ status: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/auth/register");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      password: "hunter2hunter2",
    });
  });

  it("login posts the password to /api/auth/login", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createAuthClient("http://127.0.0.1:8629/");
    expect(await client.login("hunter2")).toEqual({ status: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/auth/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ password: "hunter2" });
  });

  it("changePassword puts both passwords to /api/auth/password", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createAuthClient("http://127.0.0.1:8629/");
    expect(await client.changePassword("old-password", "new-password")).toEqual(
      { status: "ok" },
    );
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/auth/password");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      current_password: "old-password",
      new_password: "new-password",
    });
  });

  it("logout posts with an empty body; session is a plain GET", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createAuthClient("");
    await client.logout();
    await client.session();
    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    expect(calls[0]).toEqual(["/api/auth/logout", { method: "POST" }]);
    expect(calls[1]).toEqual(["/api/auth/session", undefined]);
  });

  it("decodes the session state shape", async () => {
    stubFetch(
      200,
      JSON.stringify({
        state: "authenticated",
        expires_at: "2026-10-27T08:00:00.000Z",
      }),
    );
    const client = createAuthClient("");
    expect(await client.session()).toEqual({
      state: "authenticated",
      expires_at: "2026-10-27T08:00:00.000Z",
    });
  });

  it("maps a wrong-password body into ApiError", async () => {
    stubFetch(
      401,
      JSON.stringify({
        statusCode: 401,
        message: "wrong password",
        error: "Unauthorized",
        errorCode: "INVALID_CREDENTIALS",
      }),
    );
    const client = createAuthClient("");
    const error = (await client
      .login("nope")
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("listTokens is a plain GET on /api/auth/tokens", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ tokens: [] }));
    const client = createAuthClient("");
    expect(await client.listTokens()).toEqual({ tokens: [] });
    expect(fetchMock.mock.calls[0]).toEqual(["/api/auth/tokens", undefined]);
  });

  it("createToken posts the name to /api/auth/tokens", async () => {
    const fetchMock = stubFetch(
      200,
      JSON.stringify({ token: { id: "t1" }, secret: "s3cret" }),
    );
    const client = createAuthClient("http://127.0.0.1:8629/");
    expect(await client.createToken({ name: "script" })).toEqual({
      token: { id: "t1" },
      secret: "s3cret",
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/auth/tokens");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "script" });
  });

  it("revokeToken deletes /api/auth/tokens/:id, escaping the id", async () => {
    const fetchMock = stubFetch(
      200,
      JSON.stringify({
        id: "t 1",
        action: "revoked",
        revoked_at: "2026-11-27T08:00:00.000Z",
      }),
    );
    const client = createAuthClient("");
    expect(await client.revokeToken("t 1")).toEqual({
      id: "t 1",
      action: "revoked",
      revoked_at: "2026-11-27T08:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/auth/tokens/t%201",
      { method: "DELETE" },
    ]);
  });

  it("maps a closed registration window into ApiError", async () => {
    stubFetch(
      403,
      JSON.stringify({
        statusCode: 403,
        message: "the registration window has closed",
        error: "Forbidden",
        errorCode: "REGISTRATION_CLOSED",
      }),
    );
    const client = createAuthClient("");
    const error = (await client
      .register("hunter2hunter2")
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("REGISTRATION_CLOSED");
  });
});
