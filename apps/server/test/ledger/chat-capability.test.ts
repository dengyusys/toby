/**
 * The ledger chat capability: the write outcome mapping (receipt with the
 * domain's confirmation copy, or the follow-up question), the three
 * read-only tools' rendering against the ledger service, and the
 * deterministic inspect-link mapping. Everything a routed write or read
 * needs is owned here — chat holds none of it.
 */

import { describe, expect, it } from "vitest";
import { createLedgerChatCapability } from "../../src/domains/ledger/chat-capability.ts";
import type { LedgerService } from "../../src/domains/ledger/service.ts";
import type {
  LedgerDayReport,
  LedgerMonthReport,
  LedgerReceiptView,
  LedgerUpdateResult,
} from "../../src/domains/ledger/types.ts";

const receipt: LedgerReceiptView = {
  created_at: "2026-11-05T08:00:00.000Z",
  written: 2,
  transaction_ids: [1, 2],
  entries: [],
};

function fakeService(
  overrides: {
    write?: LedgerService["write"];
    monthReport?: LedgerService["monthReport"];
    dayReport?: LedgerService["dayReport"];
  } = {},
): LedgerService {
  const month: LedgerMonthReport = {
    month: "2026-11",
    income_total: 5000,
    expense_total: 12000,
    categories: [{ type: "expense", category: "餐饮", total: 12000 }],
    transactions: [
      {
        id: 1,
        created_at: "2026-11-05T08:00:00.000Z",
        date: "2026-11-05",
        type: "expense",
        category: "餐饮",
        amount: 12000,
        note: "午饭",
      },
    ],
  };
  const day: LedgerDayReport = {
    date: "2026-11-05",
    income_total: 0,
    expense_total: 0,
    categories: [],
    transactions: [],
  };
  return {
    write: overrides.write ?? (async () => receipt),
    deleteTransaction: async () => {
      throw new Error("unused");
    },
    updateTransaction: async () => {
      throw new Error("unused");
    },
    months: async () => ({ months: ["2026-11", "2026-10"] }),
    monthReport: overrides.monthReport ?? (async () => month),
    dayReport: overrides.dayReport ?? (async () => day),
  };
}

describe("ledger chat capability", () => {
  it("maps a landed edit to a receipt outcome with its own copy", async () => {
    const updated: LedgerUpdateResult = {
      transaction_id: 7,
      action: "updated",
      before: {
        id: 7,
        date: "2026-11-05",
        type: "expense",
        category: "餐饮",
        amount: 12000,
        note: "午饭",
        created_at: "2026-11-05T08:00:00.000Z",
      },
      after: {
        id: 7,
        date: "2026-11-05",
        type: "expense",
        category: "交通",
        amount: 12000,
        note: "午饭",
        created_at: "2026-11-05T08:00:00.000Z",
      },
      updated_at: "2026-11-05T08:10:00.000Z",
    };
    const capability = createLedgerChatCapability(
      fakeService({ write: async () => updated }),
    );
    const outcome = await capability.handleWrite("不对,是打车");
    expect(outcome).toMatchObject({
      kind: "receipt",
      confirmText: "已修改 1 笔。",
      receipt: { action: "updated" },
    });
  });

  it("maps a landed write to a receipt outcome carrying its own copy", async () => {
    const capability = createLedgerChatCapability(fakeService());
    const outcome = await capability.handleWrite("午饭 30 微信");
    expect(outcome).toMatchObject({
      kind: "receipt",
      confirmText: "已记入 2 笔。",
      receipt: { written: 2 },
    });
  });

  it("maps a clarifying question to the question outcome", async () => {
    const capability = createLedgerChatCapability(
      fakeService({
        write: async () => ({ question: "这笔用的哪个账户?" }),
      }),
    );
    const outcome = await capability.handleWrite("记一笔 8 块");
    expect(outcome).toEqual({ kind: "question", text: "这笔用的哪个账户?" });
  });

  it("renders the month report through the read-only tool", async () => {
    const capability = createLedgerChatCapability(fakeService());
    const tool = capability.tools.find(
      (entry) => entry.tool.name === "ledger_month_report",
    )!;
    const result = await tool.tool.execute("c1", { month: "2026-11" });
    const text = result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    expect(text).toContain("2026-11 月:收入 ¥50.00,支出 ¥120.00");
    expect(text).toContain("支·餐饮 合计 ¥120.00");
    expect(text).toContain("2026-11-05 支 ¥120.00 餐饮(午饭)");
  });

  it("maps the month-report tool call to its inspect target, deterministically", () => {
    const capability = createLedgerChatCapability(fakeService());
    expect(
      capability.inspectTarget("ledger_month_report", { month: "2026-11" }),
    ).toEqual({ target: "ledger:2026-11", label: "2026 年 11 月账单" });
    expect(
      capability.inspectTarget("ledger_month_report", { month: "not-a-month" }),
    ).toBeUndefined();
    expect(
      capability.inspectTarget("ledger_day", { date: "2026-11-05" }),
    ).toBeUndefined();
  });
});
