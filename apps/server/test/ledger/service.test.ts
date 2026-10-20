/**
 * Ledger service against a fake store and an injected clock: the proposal
 * lifecycle — auto-write after the confirmation window, single-flight and
 * idempotent commit, cancel semantics, expiry, memory pruning.
 */

import { describe, expect, it } from "vitest";
import { assembleLedgerService } from "../../src/domains/ledger/service.ts";
import type { LedgerStore } from "../../src/domains/ledger/store.ts";
import type {
  LedgerEntry,
  LedgerProposalView,
} from "../../src/domains/ledger/types.ts";
import { AiError } from "../../src/infrastructure/ai/errors.ts";
import type { AiClient } from "../../src/infrastructure/ai/types.ts";

const AUTO_WRITE_MS = 30_000;
const TTL_MS = 600_000;
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

interface StoreCall {
  entries: readonly LedgerEntry[];
}

function fakeStore(options: { failFirstWrites?: number } = {}) {
  const calls: StoreCall[] = [];
  let writes = 0;
  let nextId = 1;
  const store: LedgerStore = {
    async insertTransactions(entries) {
      writes += 1;
      if (writes <= (options.failFirstWrites ?? 0)) {
        throw new Error("store down");
      }
      calls.push({ entries });
      return entries.map(() => nextId++);
    },
    async listMonths() {
      return [];
    },
    async listMonthTransactions() {
      return [];
    },
  };
  return { store, calls };
}

function makeService(store: LedgerStore, ai?: AiClient) {
  let nowMs = Date.parse("2026-10-20T08:00:00.000Z");
  const service = assembleLedgerService(store, {
    now: () => nowMs,
    autoWriteDelayMs: AUTO_WRITE_MS,
    ttlMs: TTL_MS,
    retentionMs: RETENTION_MS,
    ...(ai ? { ai } : {}),
  });
  return {
    service,
    advance: (ms: number) => {
      nowMs += ms;
    },
    nowMs: () => nowMs,
  };
}

const structuredBody = {
  entry: {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    account: "微信",
    amount: "25",
    note: "午饭",
  },
};

// Structured-path helper: narrows the proposal|follow-up union.
async function propose(
  service: ReturnType<typeof assembleLedgerService>,
): Promise<LedgerProposalView> {
  const result = await service.createProposal(structuredBody);
  if (!("proposal_id" in result)) {
    throw new Error("expected a proposal from the structured path");
  }
  return result;
}

describe("ledger service proposal lifecycle", () => {
  it("creates a normalized pending proposal from the structured path", async () => {
    const { service } = makeService(fakeStore().store);
    const view = await propose(service);
    expect(view.status).toBe("pending");
    expect(view.entries).toEqual([entry()]);
    expect(view.entries[0]!.amount).toBe(2500);
  });

  it("manual commit writes once; re-commit echoes the same result", async () => {
    const { store, calls } = fakeStore();
    const { service } = makeService(store);
    const view = await propose(service);
    const first = await service.commit(view.proposal_id);
    expect(first).toEqual({
      proposal_id: view.proposal_id,
      status: "committed",
      written: 1,
      transaction_ids: [1],
      committed_at: first.committed_at,
    });
    const second = await service.commit(view.proposal_id);
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("auto-writes pending proposals past the confirmation window via sweep", async () => {
    const { store, calls } = fakeStore();
    const { service, advance } = makeService(store);
    const view = await propose(service);
    advance(AUTO_WRITE_MS - 1);
    await service.sweep();
    expect(calls).toHaveLength(0); // inside the confirmation window: no write
    advance(1);
    await service.sweep();
    expect(calls).toHaveLength(1); // window elapsed, not cancelled: written
    // A late manual commit is idempotent, not a second write.
    const result = await service.commit(view.proposal_id);
    expect(result.written).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("cancel inside the window prevents any write; commit afterwards is 409", async () => {
    const { store, calls } = fakeStore();
    const { service, advance } = makeService(store);
    const view = await propose(service);
    advance(AUTO_WRITE_MS - 1);
    await expect(service.cancel(view.proposal_id)).resolves.toEqual({
      proposal_id: view.proposal_id,
      status: "cancelled",
    });
    await service.sweep(); // past the window now, but cancelled: nothing written
    expect(calls).toHaveLength(0);
    await expect(service.commit(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_CANCELLED",
      status: 409,
    });
  });

  it("cancel is idempotent; cancelling a committed proposal is 409", async () => {
    const { store } = fakeStore();
    const { service } = makeService(store);
    const view = await propose(service);
    await service.commit(view.proposal_id);
    await expect(service.cancel(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_COMMITTED",
      status: 409,
    });

    const other = await propose(service);
    expect((await service.cancel(other.proposal_id)).status).toBe("cancelled");
    expect((await service.cancel(other.proposal_id)).status).toBe("cancelled");
  });

  it("a failing write is retried by the sweeper until it succeeds", async () => {
    const { store, calls } = fakeStore({ failFirstWrites: 2 });
    const { service, advance } = makeService(store);
    const view = await propose(service);
    // Manual commit fails with the store down.
    await expect(service.commit(view.proposal_id)).rejects.toThrow(
      "store down",
    );
    advance(AUTO_WRITE_MS);
    await service.sweep(); // retry 1: still failing
    expect(calls).toHaveLength(0);
    await service.sweep(); // retry 2: succeeds
    expect(calls).toHaveLength(1);
    expect((await service.commit(view.proposal_id)).written).toBe(1);
  });

  it("expired proposals answer 410 on commit and cancel", async () => {
    const { store } = fakeStore();
    const { service, advance } = makeService(store);
    const view = await propose(service);
    advance(TTL_MS + 1);
    await expect(service.commit(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_EXPIRED",
      status: 410,
    });
    await expect(service.cancel(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_EXPIRED",
      status: 410,
    });
  });

  it("sweep expires stale pending proposals and prunes old records", async () => {
    const { store } = fakeStore();
    const { service, advance } = makeService(store);
    const view = await propose(service);
    advance(TTL_MS + 1);
    await service.sweep();
    // Expired but retained: still a 410, not a 404.
    await expect(service.commit(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_EXPIRED",
      status: 410,
    });
    advance(RETENTION_MS + 1);
    service.sweep();
    await expect(service.commit(view.proposal_id)).rejects.toMatchObject({
      code: "PROPOSAL_NOT_FOUND",
      status: 404,
    });
  });

  it("unknown proposals are 404; text without an AI transport answers 501", async () => {
    const { service } = makeService(fakeStore().store);
    await expect(service.commit("missing")).rejects.toMatchObject({
      code: "PROPOSAL_NOT_FOUND",
      status: 404,
    });
    await expect(
      service.createProposal({ text: "午饭花了25" }),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 501 });
  });

  it("month reports reject bad months and aggregate empty months", async () => {
    const { service } = makeService(fakeStore().store);
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
});

describe("ledger service one-sentence path", () => {
  function fakeAi(reply: () => unknown) {
    const calls: { messages: { role: string; content: string }[] }[] = [];
    return {
      calls,
      json: async (
        messages: readonly { role: string; content: string }[],
      ): Promise<unknown> => {
        calls.push({ messages: [...messages] });
        return reply();
      },
      text: async (): Promise<string> => "unused",
    };
  }

  function makeAiService(
    reply: () => unknown,
    store: LedgerStore = fakeStore().store,
  ) {
    const ai = fakeAi(reply);
    const harness = makeService(store, ai as unknown as AiClient);
    return { ...harness, ai };
  }

  it("turns a sentence into a normalized proposal via the AI", async () => {
    const { service, ai } = makeAiService(() => ({
      entries: [
        {
          date: "2026-10-19",
          type: "expense",
          category: "餐饮",
          // No account named in the sentence — the AI omits the field.
          amount: "35",
          note: "昨晚外卖",
        },
        {
          date: "2026-10-20",
          type: "income",
          category: "退款",
          account: "支付宝",
          amount: "12.5",
          note: "",
        },
      ],
    }));
    const result = await service.createProposal({
      text: "昨晚外卖35,今天退了个12块5",
    });
    if (!("entries" in result)) {
      throw new Error("expected a proposal");
    }
    expect(result.status).toBe("pending");
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
    // The prompt pins today's local date for relative-date resolution.
    expect(ai.calls[0]!.messages[0]!.content).toContain("2026-10-20");
    expect(ai.calls[0]!.messages[1]!.content).toContain("外卖");
  });

  it("returns the AI's clarifying question instead of guessing", async () => {
    const { service } = makeAiService(() => ({
      question: "这笔是支出还是收入?",
    }));
    const result = await service.createProposal({ text: "book 25" });
    expect(result).toEqual({ question: "这笔是支出还是收入?" });
  });

  it("maps transport failures to 501/502 domain errors", async () => {
    const unconfigured = makeAiService(() => {
      throw new AiError("unconfigured", "no key");
    });
    await expect(
      unconfigured.service.createProposal({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 501,
    });
    const upstream = makeAiService(() => {
      throw new AiError("request-failed", "provider 500");
    });
    await expect(
      upstream.service.createProposal({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_REQUEST_FAILED",
      status: 502,
    });
  });

  it("bad AI entries are intercepted with zero proposals and zero writes", async () => {
    const { store, calls } = fakeStore();
    const { service } = makeAiService(
      () => ({
        entries: [
          {
            date: "2026-10-20",
            type: "expense",
            category: "餐饮",
            account: "微信",
            amount: "abc",
          },
        ],
      }),
      store,
    );
    await expect(
      service.createProposal({ text: "午饭 abc 元" }),
    ).rejects.toMatchObject({
      code: "INVALID_ENTRY",
    });
    expect(calls).toHaveLength(0);
  });

  it("empty text is rejected before any AI call", async () => {
    const { service, ai } = makeAiService(() => ({ entries: [] }));
    await expect(service.createProposal({ text: "   " })).rejects.toMatchObject(
      {
        code: "INVALID_ENTRY",
      },
    );
    expect(ai.calls).toHaveLength(0);
  });
});
