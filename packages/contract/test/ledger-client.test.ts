/**
 * Ledger client against a stubbed fetch: request paths, bodies and typed
 * decoding for every endpoint; error-envelope mapping for write failures.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createLedgerClient } from "../src/index.ts";

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (input: string | URL, init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, url: String(input), init }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLedgerClient", () => {
  it("posts the structured entry to /api/ledger/entries", async () => {
    const fetchMock = stubFetch();
    const client = createLedgerClient("http://127.0.0.1:8629/");
    await client.writeStructuredEntry({
      date: "2026-10-20",
      type: "expense",
      category: "餐饮",
      account: "微信",
      amount: "25.5",
      note: "午饭",
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("http://127.0.0.1:8629/api/ledger/entries");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      entry: {
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        account: "微信",
        amount: "25.5",
        note: "午饭",
      },
    });
  });

  it("posts a sentence for the AI path", async () => {
    const fetchMock = stubFetch();
    const client = createLedgerClient("");
    await client.writeFromText("午饭花了25");
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("/api/ledger/entries");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "午饭花了25" });
  });

  it("encodes the month into the transactions query", async () => {
    const fetchMock = stubFetch();
    const client = createLedgerClient("");
    await client.monthReport("2026-10");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ledger/transactions?month=2026-10",
      undefined,
    );
  });

  it("unwraps the months array", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ months: ["2026-10", "2026-09"] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createLedgerClient("");
    expect(await client.listMonths()).toEqual(["2026-10", "2026-09"]);
  });

  it("write failures decode into ApiError codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 400,
              message: "amount has more than two decimals",
              error: "Bad Request",
              errorCode: "INVALID_ENTRY",
            }),
            { status: 400 },
          ),
      ),
    );
    const client = createLedgerClient("");
    const error = (await client
      .writeStructuredEntry({
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        account: "微信",
        amount: "25.555",
        note: "午饭",
      })
      .catch((thrown: unknown) => thrown)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("INVALID_ENTRY");
  });
});
