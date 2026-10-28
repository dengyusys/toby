/**
 * Ledger domain HTTP contract, driven through supertest against the fully
 * assembled domain (real sqlite in a fresh temporary directory per case,
 * injected clock). Pins the public shapes: proposal views, commit
 * idempotency, cancel/expiry status codes, month reports, empty states.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { LedgerModule } from "../../src/domains/ledger/ledger.module.ts";
import {
  LEDGER_EXTRACTOR,
  LEDGER_TIMING,
} from "../../src/domains/ledger/tokens.ts";
import type {
  LedgerDraft,
  LedgerExtractor,
} from "../../src/domains/ledger/extraction.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-ledger-api-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const AUTO_WRITE_MS = 30_000;
const TTL_MS = 600_000;
const BASE_MS = Date.parse("2026-10-20T08:00:00.000Z");

let app: NestNodeApplication;
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
    modules: [LedgerModule],
    clock: () => nowMs,
    overrides: (builder) => {
      let b = builder
        .overrideProvider(LEDGER_TIMING)
        .useValue({ autoWriteDelayMs: AUTO_WRITE_MS, ttlMs: TTL_MS });
      if (extractor) {
        b = b.overrideProvider(LEDGER_EXTRACTOR).useValue(extractor);
      }
      return b;
    },
  });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const agent = request(app.getHttpServer());
  const call = method === "GET" ? agent.get(url) : agent.post(url);
  return payload === undefined ? call : call.send(payload);
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
    expect(response.status).toBe(200);
    const body = response.body;
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
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe("INVALID_ENTRY");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.body).toEqual({ months: [] });
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
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe("BAD_REQUEST");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.body).toEqual({ months: [] });
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
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe("INVALID_ENTRY");
    }
    const months = await inject("GET", "/api/ledger/months");
    expect(months.body).toEqual({ months: [] });
  });

  it("the one-sentence text path answers 501 when the extractor is absent", async () => {
    const response = await inject("POST", "/api/ledger/proposals", {
      text: "午饭花了25",
    });
    expect(response.status).toBe(501);
    expect(response.body.errorCode).toBe("AI_UNAVAILABLE");
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
    expect(proposed.status).toBe(200);
    expect(proposed.body.status).toBe("pending");
    expect(proposed.body.entries[0].amount).toBe(2500);

    const asked = await inject("POST", "/api/ledger/proposals", {
      text: "再来一杯咖啡",
    });
    expect(asked.status).toBe(200);
    expect(asked.body).toEqual({ question: "这笔用的哪个账户?" });

    const committed = await inject(
      "POST",
      `/api/ledger/proposals/${proposed.body.proposal_id}/commit`,
    );
    expect(committed.status).toBe(200);
    const months = await inject("GET", "/api/ledger/months");
    expect(months.body).toEqual({ months: ["2026-10"] });
  });

  it("commit writes the batch once and is idempotent", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).body;
    const first = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      proposal_id: created.proposal_id,
      status: "committed",
      written: 1,
      transaction_ids: [1],
      committed_at: first.body.committed_at,
    });
    const again = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).body;
    expect(report.transactions).toHaveLength(1); // no duplicate rows
  });

  it("cancel prevents the write; a later commit is PROPOSAL_CANCELLED", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).body;
    const cancelled = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({
      proposal_id: created.proposal_id,
      status: "cancelled",
    });
    const commit = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(commit.status).toBe(409);
    expect(commit.body.errorCode).toBe("PROPOSAL_CANCELLED");
    const months = await inject("GET", "/api/ledger/months");
    expect(months.body).toEqual({ months: [] }); // zero writes
  });

  it("expired proposals answer 410; unknown ids answer 404", async () => {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry())
    ).body;
    nowMs += TTL_MS + 1;
    const commit = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(commit.status).toBe(410);
    expect(commit.body.errorCode).toBe("PROPOSAL_EXPIRED");

    const missing = await inject("POST", "/api/ledger/proposals/nope/commit");
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe("PROPOSAL_NOT_FOUND");
  });
});

describe("ledger api: months and reports", () => {
  async function commitEntry(overrides: Record<string, unknown>) {
    const created = (
      await inject("POST", "/api/ledger/proposals", structuredEntry(overrides))
    ).body;
    const committed = await inject(
      "POST",
      `/api/ledger/proposals/${created.proposal_id}/commit`,
    );
    expect(committed.status).toBe(200);
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
    expect(months.body).toEqual({ months: ["2026-10", "2026-09"] });

    const report = (
      await inject("GET", "/api/ledger/transactions?month=2026-10")
    ).body;
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
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
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
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe("INVALID_MONTH");
    }
  });

  it("GET on a POST-only endpoint is a not-found, like any other", async () => {
    const response = await inject("GET", "/api/ledger/proposals");
    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe("PAGE_NOT_FOUND");
  });
});
