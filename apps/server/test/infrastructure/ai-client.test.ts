/**
 * OpenAI-compatible transport against a stubbed fetch: request shape,
 * auth, JSON recovery (code fences), the single parse retry, and error
 * mapping. Automated tests never touch a real model.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../../src/infrastructure/ai/errors.ts";
import { createOpenAiCompatibleClient } from "../../src/infrastructure/ai/openai-compatible.ts";

const CONFIG = {
  baseUrl: "https://ai.example/v1/",
  apiKey: "key-1",
  model: "test-model",
  timeoutMs: 5_000,
};

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
}

function stubFetch(
  responder: () => Response | "throw",
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => {
    const result = responder();
    return result === "throw"
      ? Promise.reject(new Error("network down"))
      : Promise.resolve(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenAiCompatibleClient", () => {
  it("sends the chat-completions request with bearer auth and model", async () => {
    const fetchMock = stubFetch(() => completion('{"a":1}'));
    const client = createOpenAiCompatibleClient(CONFIG);
    expect(await client.json([{ role: "user", content: "hi" }])).toEqual({
      a: 1,
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("https://ai.example/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer key-1",
    );
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("recovers JSON wrapped in code fences without a retry", async () => {
    const fetchMock = stubFetch(() =>
      completion('```json\n{"entries": []}\n```'),
    );
    const client = createOpenAiCompatibleClient(CONFIG);
    expect(await client.json([{ role: "user", content: "x" }])).toEqual({
      entries: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once with a correction prompt on unparseable output", async () => {
    const fetchMock = stubFetch(() => completion("not json at all"));
    const client = createOpenAiCompatibleClient(CONFIG);
    const error = (await client
      .json([{ role: "user", content: "x" }])
      .catch((thrown: unknown) => thrown)) as AiError;
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("unparseable-output");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryBody = JSON.parse(String(retryInit.body)) as {
      messages: { content: string }[];
    };
    expect(retryBody.messages.at(-1)?.content).toContain("not valid JSON");
  });

  it("succeeds when the retry produces valid JSON", async () => {
    let call = 0;
    const fetchMock = stubFetch(() => {
      call += 1;
      return completion(call === 1 ? "garbage" : '{"ok": true}');
    });
    const client = createOpenAiCompatibleClient(CONFIG);
    expect(await client.json([{ role: "user", content: "x" }])).toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps non-ok provider responses to request-failed with the status", async () => {
    stubFetch(() => new Response('{"error":"bad key"}', { status: 401 }));
    const client = createOpenAiCompatibleClient(CONFIG);
    const error = (await client
      .text([{ role: "user", content: "x" }])
      .catch((thrown: unknown) => thrown)) as AiError;
    expect(error.code).toBe("request-failed");
    expect(error.message).toContain("401");
  });

  it("maps network failures and empty content to request-failed", async () => {
    stubFetch(() => "throw");
    const client = createOpenAiCompatibleClient(CONFIG);
    const networkError = (await client
      .text([{ role: "user", content: "x" }])
      .catch((thrown: unknown) => thrown)) as AiError;
    expect(networkError.code).toBe("request-failed");

    stubFetch(
      () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );
    const emptyError = (await client
      .text([{ role: "user", content: "x" }])
      .catch((thrown: unknown) => thrown)) as AiError;
    expect(emptyError.code).toBe("request-failed");
  });

  it("refuses to call out when unconfigured", async () => {
    const fetchMock = stubFetch(() => completion("{}"));
    const client = createOpenAiCompatibleClient({
      ...CONFIG,
      apiKey: "",
      model: "",
    });
    const error = (await client
      .json([{ role: "user", content: "x" }])
      .catch((thrown: unknown) => thrown)) as AiError;
    expect(error.code).toBe("unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
