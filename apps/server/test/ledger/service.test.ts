/**
 * Ledger service against a fake repository and an injected clock: the
 * direct-write lifecycle — a validated batch lands in one repository
 * call, the receipt is what landed — plus the month/day reports and the
 * one-sentence AI path.
 */

import { describe, expect, it } from "vitest";
import type { EntryBody } from "../../src/domains/ledger/schema.ts";
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
  LedgerEntryPatch,
  LedgerReceiptView,
  LedgerTransactionRow,
} from "../../src/domains/ledger/types.ts";
import { AiError } from "../../src/infrastructure/model/errors.ts";

// The repository methods the service actually calls; fakes satisfy that slice.
type LedgerRepositoryLike = Pick<
  LedgerRepository,
  | "insertTransactions"
  | "listMonths"
  | "listMonthTransactions"
  | "listDayTransactions"
  | "updateTransaction"
>;

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    amount: 2500,
    note: "午饭",
    ...overrides,
  };
}

interface RepositoryCall {
  entries: readonly LedgerEntry[];
}

interface UpdateCall {
  id: number;
  patch: LedgerEntryPatch;
}

function fakeRepository(
  options: {
    failWrites?: boolean;
    dayRows?: readonly LedgerTransactionRow[];
    updateResult?: {
      before: LedgerTransactionRow;
      after: LedgerTransactionRow;
    };
  } = {},
) {
  const calls: RepositoryCall[] = [];
  const updates: UpdateCall[] = [];
  let nextId = 1;
  const repository: LedgerRepositoryLike = {
    async insertTransactions(entries) {
      if (options.failWrites) {
        throw new Error("repository down");
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
    async listDayTransactions() {
      return options.dayRows ?? [];
    },
    async updateTransaction(id, patch) {
      updates.push({ id, patch });
      return options.updateResult;
    },
  };
  return { repository, calls, updates };
}

function makeService(
  repository: LedgerRepositoryLike,
  extractor?: LedgerExtractor,
) {
  let nowMs = Date.parse("2026-10-20T08:00:00.000Z");
  const service = createLedgerService({
    repository: repository as unknown as LedgerRepository,
    clock: () => nowMs,
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

const structuredBody: EntryBody = {
  entry: {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    amount: "25",
    note: "午饭",
  },
};

// Structured-path helper: narrows the receipt|follow-up union.
async function record(service: LedgerService): Promise<LedgerReceiptView> {
  const result = await service.write(structuredBody);
  if (!("written" in result)) {
    throw new Error("expected a receipt from the structured path");
  }
  return result;
}

describe("ledger service direct writes", () => {
  it("executes the structured path at once and returns what landed", async () => {
    const { repository, calls } = fakeRepository();
    const { service, nowMs } = makeService(repository);
    const receipt = await record(service);
    expect(calls).toHaveLength(1); // written before the reply exists
    expect(receipt.entries).toEqual([entry()]);
    expect(receipt.entries[0]!.amount).toBe(2500);
    expect(receipt.written).toBe(1);
    expect(receipt.transaction_ids).toEqual([1]);
    expect(receipt.created_at).toBe(new Date(nowMs()).toISOString());
  });

  it("a failing write rejects the write call and returns no receipt", async () => {
    const { repository } = fakeRepository({ failWrites: true });
    const { service } = makeService(repository);
    await expect(record(service)).rejects.toThrow("repository down");
  });

  it("text without an extractor answers 501", async () => {
    const { service } = makeService(fakeRepository().repository);
    await expect(service.write({ text: "午饭花了25" })).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 501,
    });
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
        amount: 2500,
        note: "午饭",
        created_at: "2026-10-20T08:00:00.000Z",
      },
      {
        id: 2,
        date: "2026-10-20",
        type: "income",
        category: "工资",
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

describe("ledger service updates", () => {
  const storedRow: LedgerTransactionRow = {
    id: 7,
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    amount: 3000,
    note: "午饭",
    created_at: "2026-10-19T08:00:00.000Z",
  };

  it("validates the patch, updates once, and returns the before/after snapshot", async () => {
    const after = { ...storedRow, amount: 3500 };
    const { repository, updates } = fakeRepository({
      updateResult: { before: storedRow, after },
    });
    const { service, nowMs } = makeService(repository);

    const result = await service.updateTransaction("7", { amount: "35" });

    expect(updates).toEqual([{ id: 7, patch: { amount: 3500 } }]);
    expect(result).toEqual({
      transaction_id: 7,
      action: "updated",
      before: storedRow,
      after,
      updated_at: new Date(nowMs()).toISOString(),
    });
  });

  it("rejects bad ids, empty patches, and bad semantics before the repository is touched", async () => {
    const { repository, updates } = fakeRepository();
    const { service } = makeService(repository);

    await expect(
      service.updateTransaction("0", { amount: "35" }),
    ).rejects.toMatchObject({ code: "INVALID_ENTRY", statusCode: 400 });
    await expect(service.updateTransaction("7", {})).rejects.toMatchObject({
      code: "INVALID_ENTRY",
    });
    await expect(
      service.updateTransaction("7", { date: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "INVALID_ENTRY" });
    expect(updates).toHaveLength(0);
  });

  it("an unknown id answers 404 TRANSACTION_NOT_FOUND", async () => {
    const { repository } = fakeRepository();
    const { service } = makeService(repository);

    await expect(
      service.updateTransaction("99", { note: "" }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_NOT_FOUND",
      statusCode: 404,
    });
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
          amount: 3500,
          note: "昨晚外卖",
        }),
        entry({
          date: "2026-10-20",
          type: "income",
          category: "退款",
          amount: 1250,
          note: "",
        }),
      ],
    }));
    const result = await service.write({
      text: "昨晚外卖35,今天退了个12块5",
    });
    if (!("entries" in result)) {
      throw new Error("expected a receipt");
    }
    expect(result.written).toBe(2);
    expect(result.entries).toEqual([
      entry({
        date: "2026-10-19",
        amount: 3500,
        note: "昨晚外卖",
      }),
      entry({
        date: "2026-10-20",
        type: "income",
        category: "退款",
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
    const result = await service.write({ text: "book 25" });
    expect(result).toEqual({ question: "这笔是支出还是收入?" });
    // A question writes nothing — the user retries with more detail.
    expect(calls).toHaveLength(0);
  });

  it("memory receipts the draft carried ride onto the landed receipt", async () => {
    const memoryReceipt = {
      action: "remembered",
      section: "约定",
      after: "- 咖啡记「饮品」",
      created_at: "2026-10-20T08:00:00.000Z",
    };
    const { service, calls } = makeAiService(() => ({
      entries: [entry({ amount: 3000, note: "" })],
      memory_receipts: [memoryReceipt],
    }));
    const result = await service.write({ text: "午饭30,记住咖啡记饮品" });
    if (!("entries" in result)) {
      throw new Error("expected a receipt");
    }
    expect(result.written).toBe(1);
    // Opaque passthrough: the receipts travel untouched, after the fields
    // the write itself produced.
    expect(result.memory_receipts).toEqual([memoryReceipt]);
    expect(calls).toHaveLength(1);
  });

  it("a draft without memory receipts lands the old receipt shape, field absent", async () => {
    const { service } = makeAiService(() => ({
      entries: [entry({ amount: 3000, note: "" })],
    }));
    const result = await service.write({ text: "午饭30" });
    if (!("entries" in result)) {
      throw new Error("expected a receipt");
    }
    expect(result.written).toBe(1);
    // Absent, not an empty array: old responses stay byte-identical.
    expect(result).not.toHaveProperty("memory_receipts");
  });

  it("a follow-up question draft rides back verbatim — receipts or not", async () => {
    // The extractor never attaches receipts to a question (pinned in
    // extraction.test.ts); the service is a passthrough for questions,
    // it neither adds nor strips anything.
    const { service } = makeAiService(() => ({
      question: "这笔是支出还是收入?",
    }));
    const result = await service.write({ text: "book 25" });
    expect(result).toEqual({ question: "这笔是支出还是收入?" });
  });

  it("maps extractor failures to 501/502 domain errors", async () => {
    const unconfigured = makeAiService(() => {
      throw new AiError("unconfigured", "no key");
    });
    await expect(
      unconfigured.service.write({ text: "x" }),
    ).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      statusCode: 501,
    });
    const upstream = makeAiService(() => {
      throw new AiError("request-failed", "provider 500");
    });
    await expect(upstream.service.write({ text: "x" })).rejects.toMatchObject({
      code: "AI_REQUEST_FAILED",
      statusCode: 502,
    });
    const capped = makeAiService(() => {
      throw new AiError("max-turns-exceeded", "capped");
    });
    await expect(capped.service.write({ text: "x" })).rejects.toMatchObject({
      code: "AI_REQUEST_FAILED",
      statusCode: 502,
    });
  });

  it("empty text is rejected before the extractor runs", async () => {
    const { service, texts } = makeAiService(() => ({ entries: [] }));
    await expect(service.write({ text: "   " })).rejects.toMatchObject({
      code: "INVALID_ENTRY",
    });
    expect(texts).toHaveLength(0);
  });

  describe("one-sentence edits", () => {
    /** Two 餐饮 rows on 2026-10-20 — the correction's hunting ground. */
    const dayRows: LedgerTransactionRow[] = [
      {
        id: 11,
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        amount: 3000,
        note: "午饭",
        created_at: "2026-10-20T07:00:00.000Z",
      },
      {
        id: 12,
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        amount: 4500,
        note: "晚饭",
        created_at: "2026-10-20T07:30:00.000Z",
      },
    ];

    function makeEditHarness(
      dayRows: readonly LedgerTransactionRow[],
      updateResult: {
        before: LedgerTransactionRow;
        after: LedgerTransactionRow;
      },
      draft: () => LedgerDraft,
    ) {
      const repo = fakeRepository({ dayRows, updateResult });
      const fake = fakeExtractor(draft);
      const harness = makeService(repo.repository, fake.extractor);
      return { ...harness, updates: repo.updates, calls: repo.calls };
    }

    it("a unique candidate lands as one update with before/after", async () => {
      const before = dayRows[0]!;
      const after = { ...before, amount: 3500 };
      const { service, updates } = makeEditHarness(
        dayRows,
        { before, after },
        () => ({
          edit: {
            match: { date: "2026-10-20", note_contains: "午饭" },
            patch: { amount: 3500 },
          },
        }),
      );
      const result = await service.write({ text: "把午饭那笔改成35" });
      expect(updates).toEqual([{ id: 11, patch: { amount: 3500 } }]);
      expect(result).toEqual({
        transaction_id: 11,
        action: "updated",
        before,
        after,
        updated_at: new Date("2026-10-20T08:00:00.000Z").toISOString(),
      });
      // No memory writes during this run: the update result keeps the old
      // shape, receipts absent.
      expect(result).not.toHaveProperty("memory_receipts");
    });

    it("memory receipts ride onto the update result too", async () => {
      const before = dayRows[0]!;
      const after = { ...before, amount: 3500 };
      const memoryReceipt = {
        action: "updated",
        section: "约定",
        before: "- 咖啡记「拿铁」",
        after: "- 咖啡记「饮品」",
        created_at: "2026-10-20T08:00:00.000Z",
      };
      const { service, updates } = makeEditHarness(
        dayRows,
        { before, after },
        () => ({
          edit: {
            match: { date: "2026-10-20", note_contains: "午饭" },
            patch: { amount: 3500 },
          },
          memory_receipts: [memoryReceipt],
        }),
      );
      const result = await service.write({
        text: "把午饭那笔改成35,咖啡改记饮品",
      });
      expect(updates).toEqual([{ id: 11, patch: { amount: 3500 } }]);
      // The landed update, with the run's silent-learning receipt after it.
      expect(result).toEqual({
        transaction_id: 11,
        action: "updated",
        before,
        after,
        updated_at: new Date("2026-10-20T08:00:00.000Z").toISOString(),
        memory_receipts: [memoryReceipt],
      });
    });

    it("a match without a date resolves against today", async () => {
      const before = dayRows[1]!;
      const after = { ...before, category: "交通" };
      const { service, updates } = makeEditHarness(
        dayRows,
        { before, after },
        () => ({
          edit: {
            match: { note_contains: "晚饭" },
            patch: { category: "交通" },
          },
        }),
      );
      const result = await service.write({ text: "晚饭那笔记成交通" });
      expect(updates).toEqual([{ id: 12, patch: { category: "交通" } }]);
      expect("action" in result && result.action).toBe("updated");
    });

    it("zero candidates is a question, never a write", async () => {
      const { service, updates } = makeEditHarness(
        dayRows,
        { before: dayRows[0]!, after: dayRows[0]! },
        () => ({
          edit: {
            match: { date: "2026-10-21", category: "餐饮" },
            patch: { amount: 3500 },
          },
        }),
      );
      const result = await service.write({ text: "昨天午饭改成35" });
      expect("question" in result && result.question).toContain("2026-10-21");
      expect(updates).toHaveLength(0);
    });

    it("several candidates is a question listing them, never a write", async () => {
      const { service, updates } = makeEditHarness(
        dayRows,
        { before: dayRows[0]!, after: dayRows[0]! },
        () => ({
          edit: {
            match: { date: "2026-10-20", category: "餐饮" },
            patch: { amount: 3500 },
          },
        }),
      );
      const result = await service.write({ text: "餐饮那笔改成35" });
      const question = "question" in result ? result.question : "";
      expect(question).toContain("找到 2 笔");
      expect(question).toContain("午饭");
      expect(question).toContain("晚饭");
      expect(question).toContain("要改哪一笔");
      expect(updates).toHaveLength(0);
    });
  });
});
