/**
 * Chat client against a stubbed fetch: a send carries the sentence and the
 * browser's IANA zone — read from the runtime per call, never hardcoded.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatClient } from "../src/index.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createChatClient", () => {
  it("sendMessage posts the text with the browser's zone", async () => {
    const turn = {
      turn_id: "t1",
      session_id: "s1",
      intent: "ledger",
      created_at: "2026-11-05T08:00:00.000Z",
      items: [],
    };
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(
      async () =>
        new Response(JSON.stringify(turn), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createChatClient("http://127.0.0.1:8629/");
    expect(await client.sendMessage("晚饭 20")).toEqual(turn);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/chat/messages");
    // The same source the client reads, so the assertion holds on any
    // machine's zone.
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "晚饭 20",
      time_zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });
});
