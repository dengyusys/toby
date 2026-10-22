/**
 * Ledger domain HTTP contract through app.inject against the fully
 * assembled domain (real sqlite in a fresh temporary directory per case,
 * injected clock). Pins the public shapes: proposal views, commit
 * idempotency, cancel/expiry status codes, month reports, empty states.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/infrastructure/http/app.ts";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { assembleLedger } from "../../src/domains/ledger/module.ts";
import type {
  LedgerDraft,
  LedgerExtractor,
} from "../../src/domains/ledger/extraction.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-ledger-api-"));
const staticRoot = path.join(baseDir, "static");

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const AUTO_WRITE_MS = 30_000;
const TTL_MS = 600_000;
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
  const ledger = await assembleLedger(config, {
    now: () => nowMs,
    autoWriteDelayMs: AUTO_WRITE_MS,
    ttlMs: TTL_MS,
    ...(extractor ? { extractor } : {}),
  });
  app = createServer({
    webRoot: path.join(staticRoot, "web"),
    mobileWebRoot: path.join(staticRoot, "mobile"),
    domains: [ledger],
  });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: string,
  url: string,
  payload?: Record<string, unknown>,
) {
  const options =
    payload === undefined ? { method, url } : { method, url, payload };
  return app.inject(options);
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

describe("ledger api: proposals", () => {
  it("creates a normalized proposal from the structured path", async () => {
    const response = await inject(
      "POST",
      "/api/ledger/proposals",
      structuredEntry(),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("pending");
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
    expect(new Date(body.auto_write_at).getTime()).toBe(
      BASE_MS + AUTO_WRITE_MS,
    );
    expect(new Date(body.expires_at).getTime()).toBe(BASE_MS + TTL_MS);
  });

  it("rejects bad amounts and dates with zero writes and zero proposals", async () => {
    for (const overrides of [
      { amount: "12.345" },
      { amount: -5 },
      { amount: "abc" },
      { date: "2026-02-30" },
      { date: "2026/10/20" },
      { category: "  " },
      { type: "花销" },
    ]) {
      const response = await inject(
        "POST",
        "/api/ledger/proposals",
        structuredEntry(overrides),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_ENTRY");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] });
  });

  it("the one-sentence text path answers 501 when the extractor is absent", async () => {
    const response = await inject("POST", "/api/ledger/proposals", {
      text: "午饭花了25",
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().error.code).toBe("AI_UNAVAILABLE");
  });

  it("the one-sentence AI path returns a proposal or a follow-up question", async () => {
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

    const proposed = await inject("POST", "/api/ledger/proposals", {
      text: "午饭花了25",
    });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json().status).toBe("pending");
    expect(proposed.json().entries[0].amount).toBe(2500);

    const asked = await inject("POST", "/api/ledger/proposals", {
      text: "再来一杯咖啡",
    });
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({ question: "这笔用的哪个账户?" });

    const committed = await inject(
      "POST",
      `/api/ledger/proposals/${proposed.json().proposal_id}/commit`,
    );
    expect(committed.statusCode).toBe(200);
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-10"] });
  });

  it("commit writes the batch once and is idempotent", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    const first = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      proposal_id: created.proposal_id,
      status: "committed",
      written: 1,
      transaction_ids: [1],
      committed_at: first.json().committed_at,
    });
    const again = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());

    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).json();
    expect(report.transactions).toHaveLength(1); // no duplicate rows
  });

  it("cancel prevents the write; a later commit is PROPOSAL_CANCELLED", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    const cancelled = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/cancel`,
    );
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({
      proposal_id: created.proposal_id,
      status: "cancelled",
    });
    const commit = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(commit.statusCode).toBe(409);
    expect(commit.json().error.code).toBe("PROPOSAL_CANCELLED");
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: [] }); // zero writes
  });

  it("expired proposals answer 410; unknown ids answer 404", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).json();
    nowMs += TTL_MS + 1;
    const commit = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(commit.statusCode).toBe(410);
    expect(commit.json().error.code).toBe("PROPOSAL_EXPIRED");

    const missing = await inject("POST", "/api/ledger/proposals/nope/commit");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("PROPOSAL_NOT_FOUND");
  });
});

describe("ledger api: months and reports", () => {
  async function commitEntry(overrides: Record<string, unknown>) {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry(overrides))
    ).json();
    const committed = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(committed.statusCode).toBe(200);
  }

  it("aggregates a month: totals, category subtotals, ordering", async () => {
    await commitEntry({ date: "2026-10-02", category: "交通", amount: "30" });
    await commitEntry({ date: "2026-10-20", category: "餐饮", amount: "25.5" });
    await commitEntry({ date: "2026-10-20", category: "餐饮", amount: "14.5" });
    await commitEntry({
      date: "2026-10-09",
      type: "income",
      category: "工资",
      account: "招行",
      amount: "5000",
    });
    await commitEntry({ date: "2026-09-30", category: "餐饮", amount: "10" });

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
    ]) {
      const response = await inject("GET", url);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_MONTH");
    }
  });

  it("GET on proposal endpoints discriminates as 405", async () => {
    const response = await inject("GET", "/api/ledger/proposals");
    expect(response.statusCode).toBe(405);
    expect(response.json().error.code).toBe("METHOD_NOT_ALLOWED");
  });
});
