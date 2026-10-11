/**
 * Contract package tests with a stubbed fetch: client paths, success
 * decoding, and error-envelope mapping. No real network, no server.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createSystemClient, requestJson } from "../src/index.ts";

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

describe("createSystemClient", () => {
  it("health hits /api/system/health and decodes the body", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ status: "ok" }));
    const client = createSystemClient("http://127.0.0.1:8629/");
    const health = await client.health();
    expect(health).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8629/api/system/health",
      undefined,
    );
  });

  it("info hits /api/system/info and decodes the typed body", async () => {
    const fetchMock = stubFetch(
      200,
      JSON.stringify({
        name: "toby",
        version: "0.0.0",
        node: "v22.23.2",
        started_at: "2026-10-11T00:00:00.000Z",
        uptime_seconds: 3,
      }),
    );
    const client = createSystemClient("http://127.0.0.1:8629");
    const info = await client.info();
    expect(info.name).toBe("toby");
    expect(info.uptime_seconds).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8629/api/system/info",
      undefined,
    );
  });
});

describe("requestJson error mapping", () => {
  it("decodes the { error: { code, message } } envelope into ApiError", async () => {
    stubFetch(
      404,
      JSON.stringify({
        error: { code: "PAGE_NOT_FOUND", message: "page not found" },
      }),
    );
    const error = await requestJson("http://127.0.0.1:8629/api/nope").catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe("PAGE_NOT_FOUND");
    expect(apiError.message).toBe("page not found");
  });

  it("falls back to a generic ApiError for non-envelope bodies", async () => {
    stubFetch(502, "bad gateway text");
    const error = (await requestJson(
      "http://127.0.0.1:8629/api/system/health",
    ).catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("HTTP_ERROR");
  });
});
