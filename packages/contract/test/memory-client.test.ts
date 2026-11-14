/**
 * Memory client against a stubbed fetch: the raw MEMORY.md file read
 * (success and the error envelope — a corrupt MEMORY.md must surface the
 * server's errorCode, not a generic HTTP_ERROR), the reset call, and the
 * off-record toggle round trip.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createMemoryClient } from "../src/index.ts";

function stubFetch(
  status: number,
  body: string,
  contentType = "application/json",
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(body, { status, headers: { "Content-Type": contentType } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMemoryClient", () => {
  it("readFile answers the raw text of the file route", async () => {
    stubFetch(200, "## 约定\n\n- 咖啡记「饮品」\n", "text/markdown");
    const client = createMemoryClient("http://127.0.0.1:8629/");
    expect(await client.readFile()).toBe("## 约定\n\n- 咖啡记「饮品」\n");
    const [url] = (await vi.mocked(fetch).mock.calls[0]) as [string];
    expect(url).toBe("http://127.0.0.1:8629/api/memory/file");
  });

  it("a failed read surfaces the server's errorCode, not a generic one", async () => {
    // The corrupt-file answer: 500 with the domain's closed error code.
    stubFetch(
      500,
      JSON.stringify({
        statusCode: 500,
        error: "Internal Server Error",
        errorCode: "MEMORY_FILE_INVALID",
        message: "MEMORY.md 第 1 行无法解析（请手工修正 MEMORY.md）",
      }),
    );
    const client = createMemoryClient("");
    const error = (await client
      .readFile()
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("MEMORY_FILE_INVALID");
    expect(error.message).toContain("手工修正");
  });

  it("a non-JSON read failure still answers the generic HTTP_ERROR", async () => {
    stubFetch(500, "boom", "text/plain");
    const client = createMemoryClient("");
    const error = (await client
      .readFile()
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("HTTP_ERROR");
  });

  it("reset posts to /api/memory/reset with no body and decodes the instant", async () => {
    const fetchMock = stubFetch(
      200,
      JSON.stringify({ reset_at: "2026-11-14T08:00:00.000Z" }),
    );
    const client = createMemoryClient("");
    expect(await client.reset()).toEqual({
      reset_at: "2026-11-14T08:00:00.000Z",
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("/api/memory/reset");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("the off-record toggle round-trips through its two calls", async () => {
    const fetchMock = stubFetch(200, JSON.stringify({ on: true }));
    const client = createMemoryClient("");
    expect(await client.setOffRecord(true)).toEqual({ on: true });
    expect(await client.getOffRecord()).toEqual({ on: true });
    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    expect(calls[0]).toEqual([
      "/api/memory/off-record",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: true }),
      },
    ]);
    expect(calls[1]).toEqual(["/api/memory/off-record", undefined]);
  });
});
