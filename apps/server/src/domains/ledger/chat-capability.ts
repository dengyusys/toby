/**
 * The ledger chat capability: the write path (one-sentence direct
 * writes through the service) and the none-agent's read-only ledger
 * tools, together with their inspect-link mapping — everything chat
 * used to hard-code for ledger, now owned here
 * (docs/decisions/chat-domain-capabilities.md). Built from the ledger
 * service and ledger types; the capability contract
 * (src/chat-capability.ts) is satisfied structurally, never imported
 * beyond its types.
 */

import { z } from "zod";
import { defineTool } from "../../infrastructure/model/agent.ts";
import type {
  ChatDomainCapability,
  ChatWriteOutcome,
} from "../../chat-capability.ts";
import type { LedgerService } from "./service.ts";
import type {
  LedgerCategorySummary,
  LedgerDayReport,
  LedgerMonthReport,
  LedgerTransactionRow,
} from "./types.ts";

/**
 * Inspect targets the webs know how to open (target vocabulary: panel id).
 * Deterministic: a valid month argument on the month-report tool maps to
 * the ledger month panel; nothing else does.
 */
function inspectTarget(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): { target: string; label: string } | undefined {
  if (toolName === "ledger_month_report") {
    const month = typeof args.month === "string" ? args.month : "";
    if (/^[0-9]{4}-(0[0-9]|1[0-2])$/.test(month)) {
      return {
        target: `ledger:${month}`,
        label: `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月账单`,
      };
    }
  }
  return undefined;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** One transaction line as both report tools render it. */
function formatTransaction(t: LedgerTransactionRow): string {
  return `${t.date} ${t.type === "income" ? "收" : "支"} ¥${formatCents(t.amount)} ${t.category}${t.note ? `(${t.note})` : ""}`;
}

/** Category subtotal lines, shared by the month and day reports. */
function formatCategories(
  categories: readonly LedgerCategorySummary[],
): string[] {
  return categories.map(
    (c) =>
      `${c.type === "income" ? "收" : "支"}·${c.category} 合计 ¥${formatCents(c.total)}`,
  );
}

export function createLedgerChatCapability(
  service: LedgerService,
): ChatDomainCapability {
  const ledgerMonths = defineTool("read-only", {
    name: "ledger_months",
    label: "有记录的月份",
    description: "列出账本里有记录的月份,降序。",
    promptSnippet: "列出有记录的月份",
    promptGuidelines: ["查账前先看有哪些月份,再取该月明细。"],
    parameters: z.object({}).strict(),
    execute: async () => {
      const { months } = await service.months();
      return {
        content: [
          {
            type: "text" as const,
            text:
              months.length > 0
                ? `有记录的月份:${months.join("、")}`
                : "账本还没有任何记录。",
          },
        ],
        details: { months },
      };
    },
  });

  const ledgerMonthReport = defineTool("read-only", {
    name: "ledger_month_report",
    label: "月账单",
    description: "取某个月的账单:收支合计、分类小计和逐笔明细(金额为分)。",
    promptSnippet: "取某个月的账单明细",
    parameters: z
      .object({ month: z.string().regex(/^[0-9]{4}-(0[0-9]|1[0-2])$/) })
      .strict(),
    execute: async (_toolCallId, params) => {
      const report: LedgerMonthReport = await service.monthReport(params.month);
      const lines = report.transactions.map(formatTransaction);
      const text = [
        `${report.month} 月:收入 ¥${formatCents(report.income_total)},支出 ¥${formatCents(report.expense_total)}`,
        ...formatCategories(report.categories),
        ...lines.slice(0, 30),
        ...(lines.length > 30
          ? [`(仅显示前 30 笔,共 ${lines.length} 笔)`]
          : []),
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { month: report.month },
      };
    },
  });

  const ledgerDay = defineTool("read-only", {
    name: "ledger_day",
    label: "单日账单",
    description: "取某一天的收支合计、分类小计和逐笔明细。",
    promptSnippet: "取某一天的账单明细",
    promptGuidelines: [
      "问「今天/昨天/某天」的收支时用它;date 按上下文里的今天换算成 YYYY-MM-DD。",
    ],
    parameters: z
      .object({ date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) })
      .strict(),
    execute: async (_toolCallId, params) => {
      const report: LedgerDayReport = await service.dayReport(params.date);
      const lines = report.transactions.map(formatTransaction);
      const text =
        lines.length === 0
          ? `${report.date} 没有记账记录。`
          : [
              `${report.date}:收入 ¥${formatCents(report.income_total)},支出 ¥${formatCents(report.expense_total)}`,
              ...formatCategories(report.categories),
              ...lines.slice(0, 20),
              ...(lines.length > 20
                ? [`(仅显示前 20 笔,共 ${lines.length} 笔)`]
                : []),
            ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { date: report.date },
      };
    },
  });

  return {
    intent: "ledger",
    label: "记账",
    intentDescription:
      "- ledger(记账):记一笔钱、修改或纠正已记的账、查账、问花了多少。",
    async handleWrite(sentence) {
      const result = await service.write({ text: sentence });
      if ("question" in result) {
        return { kind: "question", text: result.question };
      }
      if ("action" in result) {
        const outcome: ChatWriteOutcome = {
          kind: "receipt",
          confirmText: "已修改 1 笔。",
          receipt: result,
        };
        return outcome;
      }
      const outcome: ChatWriteOutcome = {
        kind: "receipt",
        confirmText: `已记入 ${result.written} 笔。`,
        receipt: result,
      };
      return outcome;
    },
    tools: [ledgerMonths, ledgerMonthReport, ledgerDay],
    inspectTarget,
  };
}
