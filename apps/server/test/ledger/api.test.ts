/**
 * Ledger domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real sqlite in a fresh temporary directory per
 * case, injected clock). Pins the public shapes: born-confirmed receipts,
 * the revert endpoint and its status codes, month reports, empty states.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createLedgerDomain } from "../../src/domains/ledger/plugin.ts";
import type {
  LedgerDraft,
  LedgerExtractor,
} from "../../src/domains/ledger/extraction.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-ledger-api-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const REVERT_WINDOW_MS = 600_000;
const BASE_MS = Date.parse("2026-10-20T08:00:00.000Z");

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;

async function buildApp(extractor?: LedgerExtractor): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  app = await createTestApp({
    config,
    domains: [
      (instance) =>
        instance.register(
          createLedgerDomain({
            config,
            clock: () => nowMs,
            ...(extractor ? { extractor } : {}),
            timing: { revertWindowMs: REVERT_WINDOW_MS },
          }).plugin,
        ),
    ],
  });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

function structuredEntry(overrides: Record<string, unknown> = {}) {
  return {
    entry: {
      date: "2026-10-20",
      type: "expense",
      category: "餐饮",
      account: "微信",
      amount: "25.5",
      note: "午饭",
      ...overrides,
    },
  };
}

describe("ledger api: immediate writes", () => {
  it("creates a landed batch from the structured path: a born-confirmed receipt", async () => {
    const response = await inject(
      "POST",
      "/api/ledger/proposals",
      structuredEntry(),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("committed");
    expect(typeof body.proposal_id).toBe("string");
    expect(body.entries).toEqual([
      {
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        account: "微信",
        amount: 2550,
        note: "午饭",
      },
    ]);
    expect(body.written).toBe(1);
    expect(body.transaction_ids).toEqual([1]);
    expect(body.committed_at).toBe(new Date(BASE_MS).toISOString());
    expect(new Date(body.revert_until).getTime()).toBe(
      BASE_MS + REVERT_WINDOW_MS,
    );
    // The batch has already landed: the month is visible immediately.
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-10"] });
  });

  it("rejects bad amounts and dates with zero writes and zero rows", async () => {
    // Well-formed bodies whose values are nonsense: the domain's semantic
    // gate answers, not the route schema.
    for (const overrides of [
      { amount: "12.345" },
      { amount: -5 },
      { amount: "abc" },
      { date: "2026-02-30" },
      { date: "2026/10/20" },
      { category: "  " },
    ]) {
      const response = await inject(
        "POST",
        "/api/ledger/proposals",
        structuredEntry(overrides),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_ENTRY");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("a body with no intake path is rejected by the route schema", async () => {
    // The route schema owns the envelope only: which of the two paths is
    // this, and is `text` a string. Everything inside `entry` is the domain's.
    for (const body of [
      {}, // neither path
      { text: 5 },
      { entry: undefined }, // present-but-undefined is not a path
      { text: "x", extra: 1 }, // unknown keys are not silently accepted
    ]) {
      const response = await inject("POST", "/api/ledger/proposals", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("a malformed entry is the domain's call once the envelope is right", async () => {
    // One definition of an entry shape (schema.ts) — the same one the model's
    // tool contract uses — so these all answer the domain code.
    for (const entry of [
      5,
      { ...structuredEntry().entry, type: "花销" },
      { ...structuredEntry().entry, amount: true },
      { ...structuredEntry().entry, account: 42 },
    ]) {
      const response = await inject("POST", "/api/ledger/proposals", { entry });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_ENTRY");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("the one-sentence text path answers 501 when the extractor is absent", async () => {
    const response = await inject("POST", "/api/ledger/proposals", {
      text: "午饭花了25",
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().errorCode).toBe("AI_UNAVAILABLE");
  });

  it("the one-sentence AI path returns a receipt or a follow-up question", async () => {
    const replies: LedgerDraft[] = [
      {
        entries: [
          {
            date: "2026-10-20",
            type: "expense",
            category: "餐饮",
            account: "微信",
            amount: 2500,
            note: "午饭",
          },
        ],
      },
      { question: "这笔用的哪个账户?" },
    ];
    const extractor: LedgerExtractor = {
      extract: async () => replies.shift() as LedgerDraft,
    };
    await app.close(); // release the beforeEach assembly before rebuilding
    await buildApp(extractor);

    const recorded = await inject("POST", "/api/ledger/proposals", {
      text: "午饭花了25",
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json().status).toBe("committed");
    expect(recorded.json().written).toBe(1);
    expect(recorded.json().entries[0].amount).toBe(2500);

    const asked = await inject("POST", "/api/ledger/proposals", {
      text: "再来一杯咖啡",
    });
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({ question: "这笔用的哪个账户?" });

    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-10"] });
  });
});

describe("ledger api: revert", () => {
  it("reverts a batch inside the window and the rows disappear", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    const reverted = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json()).toEqual({
      proposal_id: created.proposal_id,
      status: "reverted",
      reverted_at: new Date(BASE_MS).toISOString(),
    });
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("a settled revert echoes its outcome on repeat", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    const first = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    const second = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("reverting an intact multi-entry batch removes every row", async () => {
    const extractor: LedgerExtractor = {
      extract: async () => ({
        entries: [
          {
            date: "2026-10-20",
            type: "expense",
            category: "餐饮",
            account: "微信",
            amount: 2500,
            note: "午饭",
          },
          {
            date: "2026-10-20",
            type: "expense",
            category: "交通",
            account: "微信",
            amount: 3000,
            note: "打车",
          },
        ],
      }),
    };
    await app.close();
    await buildApp(extractor);
    const created = (
      await inject("POST", "/api/ledger/proposals", { text: "午饭25打车30" })
    ).json();
    expect(created.written).toBe(2);
    expect(created.transaction_ids).toEqual([1, 2]);

    const reverted = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    expect(reverted.statusCode).toBe(200);
    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).json();
    expect(report.transactions).toHaveLength(0);
    expect(report.expense_total).toBe(0);
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("a later delete of one batch row refuses the whole revert (newer write wins)", async () => {
    const extractor: LedgerExtractor = {
      extract: async () => ({
        entries: [
          {
            date: "2026-10-20",
            type: "expense",
            category: "餐饮",
            account: "微信",
            amount: 2500,
            note: "午饭",
          },
          {
            date: "2026-10-20",
            type: "expense",
            category: "交通",
            account: "微信",
            amount: 3000,
            note: "打车",
          },
        ],
      }),
    };
    await app.close();
    await buildApp(extractor);
    const created = (
      await inject("POST", "/api/ledger/proposals", { text: "午饭25打车30" })
    ).json();
    expect(created.transaction_ids).toEqual([1, 2]);

    const deleted = await inject("DELETE", "/api/ledger/transactions/1");
    expect(deleted.statusCode).toBe(200);

    const reverted = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    expect(reverted.statusCode).toBe(409);
    expect(reverted.json().errorCode).toBe("REVERT_CONFLICT");

    // The untouched row stays: the newer write won.
    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).json();
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0].id).toBe(2);
  });

  it("revert past the window answers 410 and the write stands", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    nowMs += REVERT_WINDOW_MS + 1;
    const reverted = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/revert`,
    );
    expect(reverted.statusCode).toBe(410);
    expect(reverted.json().errorCode).toBe("PROPOSAL_EXPIRED");
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-10"] });
  });

  it("unknown ids answer 404", async () => {
    const missing = await inject("POST", "/api/ledger/proposals/nope/revert");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("PROPOSAL_NOT_FOUND");
  });

  it("the retired commit/cancel endpoints are gone", async () => {
    for (const action of ["commit", "cancel"]) {
      const response = await inject(
        "POST",
        `/api/ledger/proposals/some-id/${action}`,
      );
      expect(response.statusCode).toBe(404);
      expect(response.json().errorCode).toBe("PAGE_NOT_FOUND");
    }
  });
});

describe("ledger api: months and reports", () => {
  async function recordEntry(overrides: Record<string, unknown>) {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry(overrides))
    ).json();
    expect(created.status).toBe("committed");
  }

  it("aggregates a month: totals, category subtotals, ordering", async () => {
    await recordEntry({ date: "2026-10-02", category: "交通", amount: "30" });
    await recordEntry({ date: "2026-10-20", category: "餐饮", amount: "25.5" });
    await recordEntry({ date: "2026-10-20", category: "餐饮", amount: "14.5" });
    await recordEntry({
      date: "2026-10-09",
      type: "income",
      category: "工资",
      account: "招行",
      amount: "5000",
    });
    await recordEntry({ date: "2026-09-30", category: "餐饮", amount: "10" });

    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-10", "2026-09"] });

    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).json();
    expect(report.month).toBe("2026-10");
    expect(report.transactions).toHaveLength(4); // no September bleed
    expect(report.transactions.map((t: { date: string }) => t.date)).toEqual([
      "2026-10-02",
      "2026-10-09",
      "2026-10-20",
      "2026-10-20",
    ]);
    expect(report.income_total).toBe(500000);
    expect(report.expense_total).toBe(7000);
    expect(report.categories).toEqual([
      { type: "expense", category: "餐饮", total: 4000 },
      { type: "expense", category: "交通", total: 3000 },
      { type: "income", category: "工资", total: 500000 },
    ]);
  });

  it("empty months report zeros; the month parameter is validated", async () => {
    const empty = await inject("GET", "/api/ledger/transactions?month=2026-10");
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      month: "2026-10",
      transactions: [],
      income_total: 0,
      expense_total: 0,
      categories: [],
    });

    for (const url of [
      "/api/ledger/transactions",
      "/api/ledger/transactions?month=2026-13",
      "/api/ledger/transactions?month=2026-1",
      // A repeated parameter is not a month either.
      "/api/ledger/transactions?month=2026-10&month=2026-11",
    ]) {
      const response = await inject("GET", url);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_MONTH");
    }
  });

  it("GET on a POST-only endpoint is a not-found, like any other", async () => {
    const response = await inject("GET", "/api/ledger/proposals");
    expect(response.statusCode).toBe(404);
    expect(response.json().errorCode).toBe("PAGE_NOT_FOUND");
  });
});

describe("ledger api: deletion", () => {
  /** Land one entry and return the written transaction id. */
  async function recordEntryAndGetId(): Promise<number> {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    expect(created.status).toBe("committed");
    return created.transaction_ids[0];
  }

  it("deletes one stored transaction and the month follows", async () => {
    const id = await recordEntryAndGetId();

    const deleted = await inject("DELETE", `/api/ledger/transactions/${id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({
      transaction_id: id,
      status: "deleted",
      deleted_at: new Date(BASE_MS).toISOString(),
    });

    const report = await inject(
      "GET",
      "/api/ledger/transactions?month=2026-10",
    );
    expect(report.json().transactions).toHaveLength(0);
    expect(report.json().expense_total).toBe(0);
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("a delete of one of two rows leaves the other intact", async () => {
    const first = await recordEntryAndGetId();
    const second = await recordEntryAndGetId();

    const deleted = await inject("DELETE", `/api/ledger/transactions/${first}`);
    expect(deleted.statusCode).toBe(200);

    const report = await inject(
      "GET",
      "/api/ledger/transactions?month=2026-10",
    );
    expect(report.json().transactions).toHaveLength(1);
    expect(report.json().transactions[0].id).toBe(second);
  });

  it("unknown ids answer 404 TRANSACTION_NOT_FOUND; malformed ids 400", async () => {
    const missing = await inject("DELETE", "/api/ledger/transactions/999");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("TRANSACTION_NOT_FOUND");

    for (const id of ["0", "-1", "abc"]) {
      const response = await inject("DELETE", `/api/ledger/transactions/${id}`);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_ENTRY");
    }
  });
});
