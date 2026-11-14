/**
 * Settings client against a stubbed fetch: the effective AI view, the one
 * PUT write, the catalog read, and the error envelope — a domain failure
 * must surface the server's errorCode, not a generic HTTP_ERROR.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createSettingsClient } from "../src/index.ts";

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

describe("createSettingsClient", () => {
  it("getAiSettings reads /api/settings/ai and decodes the view", async () => {
    const view = {
      model: { value: "zai/glm-4.7", source: "db" },
      providers: [{ id: "zai", source: "stored", maskedKey: "zai…abcd" }],
    };
    stubFetch(200, JSON.stringify(view));
    const client = createSettingsClient("http://127.0.0.1:8629/");
    expect(await client.getAiSettings()).toEqual(view);
    const [url] = (await vi.mocked(fetch).mock.calls[0]) as [string];
    expect(url).toBe("http://127.0.0.1:8629/api/settings/ai");
  });

  it("saveAiSettings PUTs the body as JSON and decodes the new view", async () => {
    const view = {
      model: { value: null, source: null },
      providers: [],
    };
    const fetchMock = stubFetch(200, JSON.stringify(view));
    const client = createSettingsClient("");
    const body = {
      model: "zai/glm-4.7",
      credentials: [{ provider: "zai", apiKey: "fake-key" }],
    };
    expect(await client.saveAiSettings(body)).toEqual(view);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("/api/settings/ai");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(init?.body).toBe(JSON.stringify(body));
  });

  it("getCatalog reads /api/settings/ai/catalog and decodes the providers", async () => {
    const catalog = {
      providers: [
        { id: "deepseek", models: ["deepseek-chat"] },
        { id: "zai", models: ["glm-4.7", "glm-5"] },
      ],
    };
    stubFetch(200, JSON.stringify(catalog));
    const client = createSettingsClient("");
    expect(await client.getCatalog()).toEqual(catalog);
    const [url] = (await vi.mocked(fetch).mock.calls[0]) as [string];
    expect(url).toBe("/api/settings/ai/catalog");
  });

  it("a domain failure surfaces the server's errorCode, not a generic one", async () => {
    stubFetch(
      400,
      JSON.stringify({
        statusCode: 400,
        error: "Bad Request",
        errorCode: "SETTINGS_INVALID_MODEL",
        message: 'model must be a "provider/model" pair (e.g. "zai/glm-4.7")',
      }),
    );
    const client = createSettingsClient("");
    const error = (await client
      .saveAiSettings({ model: "nope" })
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("SETTINGS_INVALID_MODEL");
  });

  it("a non-JSON failure still answers the generic HTTP_ERROR", async () => {
    stubFetch(500, "boom", "text/plain");
    const client = createSettingsClient("");
    const error = (await client
      .getAiSettings()
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("HTTP_ERROR");
  });
});
