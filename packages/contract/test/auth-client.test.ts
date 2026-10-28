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

  it("logout posts with an empty body; session is a plain GET", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createAuthClient("");
    await client.logout();
    await client.session();
    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    expect(calls[0]).toEqual(["/api/auth/logout", { method: "POST" }]);
    expect(calls[1]).toEqual(["/api/auth/session", undefined]);
  });

  it("decodes the session info shape", async () => {
    stubFetch(
      200,
      JSON.stringify({
        enabled: true,
        authenticated: true,
        expires_at: "2026-10-27T08:00:00.000Z",
      }),
    );
    const client = createAuthClient("");
    expect(await client.session()).toEqual({
      enabled: true,
      authenticated: true,
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
});
