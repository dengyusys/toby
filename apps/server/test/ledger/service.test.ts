/**
 * Ledger service against a fake repository and an injected clock: the
 * immediate-tier write lifecycle — execute-at-once receipts, the revert
 * window, conflict semantics, retention — and the pruner's start/stop
 * lifecycle.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProposalBody } from "../../src/domains/ledger/schema.ts";
import {
  createLedgerService,
  type LedgerService,
} from "../../src/domains/ledger/service.ts";
import type { LedgerRepository } from "../../src/domains/ledger/repository.ts";
import type {
  LedgerDraft,
  LedgerExtractor,
} from "../../src/domains/ledger/extraction.ts";
import type {
  LedgerEntry,
  LedgerReceiptView,
  LedgerTransactionRow,
} from "../../src/domains/ledger/types.ts";
import { AiError } from "../../src/infrastructure/model/errors.ts";

// The repository methods the service actually calls; fakes satisfy that slice.
type LedgerRepositoryLike = Pick<
  LedgerRepository,
  | "insertTransactions"
  | "revertTransactions"
  | "listMonths"
  | "listMonthTransactions"
  | "listDayTransactions"
>;

const REVERT_WINDOW_MS = 600_000;
const RETENTION_MS = 3_600_000;

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    account: "微信",
    amount: 2500,
    note: "午饭",
    ...overrides,
  };
}

interface RepositoryCall {
  entries: readonly LedgerEntry[];
}

function fakeRepository(
  options: {
    failWrites?: boolean;
    dayRows?: readonly LedgerTransactionRow[];
  } = {},
) {
  const calls: RepositoryCall[] = [];
  const reverted: number[][] = [];
  /** Simulated stored rows: ids the "database" still holds. */
  const stored = new Set<number>();
  let nextId = 1;
  const repository: LedgerRepositoryLike = {
    async insertTransactions(entries) {
      if (options.failWrites) {
        throw new Error("repository down");
      }
      calls.push({ entries });
      const ids = entries.map(() => {
        const id = nextId++;
        stored.add(id);
        return id;
      });
      return ids;
    },
    async revertTransactions(ids) {
      reverted.push([...ids]);
      // Conflict semantics: every row of the batch must still be there.
      if (ids.some((id) => !stored.has(id))) {
        return false;
      }
      for (const id of ids) {
        stored.delete(id);
      }
      return true;
    },
    async listMonths() {
      return [];
    },
    async listMonthTransactions() {
      return [];
    },
    async listDayTransactions() {
      return options.dayRows ?? [];
    },
  };
  return {
    repository,
    calls,
    reverted,
    stored,
    deleteRow: (id: number) => stored.delete(id),
  };
}

function makeService(
  repository: LedgerRepositoryLike,
  extractor?: LedgerExtractor,
) {
  let nowMs = Date.parse("2026-10-20T08:00:00.000Z");
  const service = createLedgerService({
    repository: repository as unknown as LedgerRepository,
    clock: () => nowMs,
    timing: {
      revertWindowMs: REVERT_WINDOW_MS,
      retentionMs: RETENTION_MS,
    },
    extractor,
  });
  return {
    service,
    advance: (ms: number) => {
      nowMs += ms;
    },
    nowMs: () => nowMs,
  };
}

const structuredBody: ProposalBody = {
  entry: {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    account: "微信",
    amount: "25",
    note: "午饭",
  },
};

// Structured-path helper: narrows the receipt|follow-up union.
async function record(service: LedgerService): Promise<LedgerReceiptView> {
  const result = await service.createProposal(structuredBody);
  if (!("proposal_id" in result)) {
    throw new Error("expected a receipt from the structured path");
  }
  return result;
}

describe("ledger service immediate writes", () => {
  it("executes the structured path at once and returns a born-confirmed receipt", async () => {
    const { repository, calls } = fakeRepository();
    const { service, nowMs } = makeService(repository);
    const receipt = await record(service);
    expect(calls).toHaveLength(1); // written before the reply exists
    expect(receipt.status).toBe("committed");
    expect(receipt.entries).toEqual([entry()]);
    expect(receipt.entries[0]!.amount).toBe(2500);
    expect(receipt.written).toBe(1);
    expect(receipt.transaction_ids).toEqual([1]);
    expect(receipt.committed_at).toBe(new Date(nowMs()).toISOString());
    expect(receipt.revert_until).toBe(
      new Date(nowMs() + REVERT_WINDOW_MS).toISOString(),
    );
  });

  it("a failing write rejects the create call and leaves no receipt behind", async () => {
    const { repository } = fakeRepository({ failWrites: true });
    const { service } = makeService(repository);
    await expect(record(service)).rejects.toThrow("repository down");
  });

  it("revert inside the window removes exactly the batch", async () => {
    const { repository, reverted } = fakeRepository();
    const { service } = makeService(repository);
    const receipt = await record(service);
    const outcome = await service.revert(receipt.proposal_id);
    expect(outcome).toEqual({
      proposal_id: receipt.proposal_id,
      status: "reverted",
      reverted_at: expect.any(String),
    });
    expect(reverted).toEqual([[1]]);
  });

  it("revert is idempotent: a settled revert echoes its outcome", async () => {
    const { repository, reverted } = fakeRepository();
    const { service } = makeService(repository);
    const receipt = await record(service);
    const first = await service.revert(receipt.proposal_id);
    const second = await service.revert(receipt.proposal_id);
    expect(second).toEqual(first);
    expect(reverted).toHaveLength(1);
  });

  it("a later write touching the batch refuses the revert (newer write wins)", async () => {
    const { repository, deleteRow } = fakeRepository();
    const { service } = makeService(repository);
    const receipt = await record(service);
    deleteRow(1); // the user deleted one row of the batch in the meantime
    await expect(service.revert(receipt.proposal_id)).rejects.toMatchObject({
      code: "REVERT_CONFLICT",
      statusCode: 409,
    });
  });

  it("revert past the window reports 410 and the write stands", async () => {
    const { repository } = fakeRepository();
    const { service, advance } = makeService(repository);
    const receipt = await record(service);
    advance(REVERT_WINDOW_MS + 1);
    await expect(service.revert(receipt.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_EXPIRED",
      statusCode: 410,
    });
  });

  it("unknown proposals are 404; text without an extractor answers 501", async () => {
    const { service } = makeService(fakeRepository().repository);
    await expect(service.revert("missing")).rejects.toMatchObject({
      code: "PROPOSAL_NOT_FOUND",
      statusCode: 404,
    });
    await expect(
      service.createProposal({ text: "午饭花了25" }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE", statusCode: 501 });
  });

  it("month reports reject bad months and aggregate empty months", async () => {
    const { service } = makeService(fakeRepository().repository);
    await expect(service.monthReport(undefined)).rejects.toMatchObject({
      code: "INVALID_MONTH",
    });
    await expect(service.monthReport("2026-13")).rejects.toMatchObject({
      code: "INVALID_MONTH",
    });
    const report = await service.monthReport("2026-10");
    expect(report).toEqual({
      month: "2026-10",
      transactions: [],
      income_total: 0,
      expense_total: 0,
      categories: [],
    });
  });

  it("day reports aggregate one date and reject impossible dates", async () => {
    const rows: LedgerTransactionRow[] = [
      {
        id: 1,
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        account: "微信",
        amount: 2500,
        note: "午饭",
        created_at: "2026-10-20T08:00:00.000Z",
      },
      {
        id: 2,
        date: "2026-10-20",
        type: "income",
        category: "工资",
        account: "未关联",
        amount: 800000,
        note: "",
        created_at: "2026-10-20T08:00:00.000Z",
      },
    ];
    const { service } = makeService(
      fakeRepository({ dayRows: rows }).repository,
    );

    const report = await service.dayReport("2026-10-20");
    expect(report.date).toBe("2026-10-20");
    expect(report.transactions).toEqual(rows);
    expect(report.income_total).toBe(800000);
    expect(report.expense_total).toBe(2500);
    expect(report.categories).toEqual([
      { type: "expense", category: "餐饮", total: 2500 },
      { type: "income", category: "工资", total: 800000 },
    ]);

    await expect(service.dayReport("2026-02-30")).rejects.toMatchObject({
      code: "INVALID_DATE",
      statusCode: 400,
    });
    await expect(service.dayReport("2026-2-3")).rejects.toMatchObject({
      code: "INVALID_DATE",
    });
  });
});

describe("ledger service pruner lifecycle", () => {
  it("start ticks without overlap and stop resolves cleanly", async () => {
    vi.useFakeTimers();
    try {
      const { service } = makeService(fakeRepository().repository);
      service.start();
      await vi.advanceTimersByTimeAsync(3_500); // a few prune ticks
      await expect(service.stop()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ledger service one-sentence path", () => {
  function fakeExtractor(draft: () => LedgerDraft | Promise<LedgerDraft>) {
    const texts: string[] = [];
    const extractor: LedgerExtractor = {
      async extract(text) {
        texts.push(text);
        return draft();
      },
    };
    return { texts, extractor };
  }

  function makeAiService(draft: () => LedgerDraft | Promise<LedgerDraft>) {
    const fakeRepositoryResult = fakeRepository();
    const fake = fakeExtractor(draft);
    const harness = makeService(
      fakeRepositoryResult.repository,
      fake.extractor,
    );
    return { ...harness, ...fake, calls: fakeRepositoryResult.calls };
  }

  it("turns a sentence into one landed batch via the extractor", async () => {
    const { service, texts, calls } = makeAiService(() => ({
      entries: [
        entry({
          date: "2026-10-19",
          account: "未关联",
          amount: 3500,
          note: "昨晚外卖",
        }),
        entry({
          date: "2026-10-20",
          type: "income",
          category: "退款",
          account: "支付宝",
          amount: 1250,
          note: "",
        }),
      ],
    }));
    const result = await service.createProposal({
      text: "昨晚外卖35,今天退了个12块5",
    });
    if (!("entries" in result)) {
      throw new Error("expected a receipt");
    }
    expect(result.status).toBe("committed");
    expect(result.written).toBe(2);
    expect(result.entries).toEqual([
      entry({
        date: "2026-10-19",
        account: "未关联",
        amount: 3500,
        note: "昨晚外卖",
      }),
      entry({
        date: "2026-10-20",
        type: "income",
        category: "退款",
        account: "支付宝",
        amount: 1250,
        note: "",
      }),
    ]);
    expect(texts).toEqual(["昨晚外卖35,今天退了个12块5"]);
    expect(calls).toHaveLength(1); // one atomic batch, already landed
  });

  it("returns the AI's clarifying question instead of guessing", async () => {
    const { service, calls } = makeAiService(() => ({
      question: "这笔是支出还是收入?",
    }));
    const result = await service.createProposal({ text: "book 25" });
    expect(result).toEqual({ question: "这笔是支出还是收入?" });
    // A question writes nothing — the user retries with more detail.
    expect(calls).toHaveLength(0);
  });

  it("maps extractor failures to 501/502 domain errors", async () => {
    const unconfigured = makeAiService(() => {
      throw new AiError("unconfigured", "no key");
    });
    await expect(
      unconfigured.service.createProposal({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 501,
    });
    const upstream = makeAiService(() => {
      throw new AiError("request-failed", "provider 500");
    });
    await expect(
      upstream.service.createProposal({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_REQUEST_FAILED",
      statusCode: 502,
    });
    const capped = makeAiService(() => {
      throw new AiError("max-turns-exceeded", "capped");
    });
    await expect(
      capped.service.createProposal({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_REQUEST_FAILED",
      statusCode: 502,
    });
  });

  it("empty text is rejected before the extractor runs", async () => {
    const { service, texts } = makeAiService(() => ({ entries: [] }));
    await expect(service.createProposal({ text: "   " })).rejects.toMatchObject(
      {
        code: "INVALID_ENTRY",
      },
    );
    expect(texts).toHaveLength(0);
  });
});
