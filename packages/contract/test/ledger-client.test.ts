/**
 * Ledger client against a stubbed fetch: request paths and typed decoding for every
 * endpoint.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLedgerClient } from "../src/index.ts";

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
});
