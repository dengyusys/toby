/**
 * The `none`-intent agent (docs/features/chat.md): read-only tools,
 * bounded rounds, real data only, honest truncation notices — write
 * requests are gently declined, because writes belong to the business
 * intents. Tools read through the injected ledger port; the run's
 * verbatim pi-ai transcript travels back for zero-translation items.
 */

import { z } from "zod";
import {
  defineTool,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { localDayLabel } from "../../infrastructure/local-date.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type {
  ChatAgent,
  ChatLedgerCategoryTotal,
  ChatLedgerPort,
  ChatLedgerTransaction,
} from "./types.ts";

// Bounded on purpose: a query settles in a couple of tool rounds; more
// means the model is wandering.
const CHAT_AGENT_MAX_TURNS = 6;
const CHAT_AGENT_MAX_TOKENS = 2000;

/** Inspect targets the webs know how to open (target vocabulary: panel id). */
export function inspectTargetOf(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): { target: string; label: string } | undefined {
  if (toolName === "ledger_month_report") {
    const month = typeof args.month === "string" ? args.month : "";
    if (/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
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

/** One transaction line as both ledger tools render it. */
function formatTransaction(t: ChatLedgerTransaction): string {
  return `${t.date} ${t.type === "income" ? "收" : "支"} ¥${formatCents(t.amount)} ${t.category}${t.note ? `(${t.note})` : ""}`;
}

/** Category subtotal lines, shared by the month and day reports. */
function formatCategories(
  categories: readonly ChatLedgerCategoryTotal[],
): string[] {
  return categories.map(
    (c) =>
      `${c.type === "income" ? "收" : "支"}·${c.category} 合计 ¥${formatCents(c.total)}`,
  );
}

export interface ChatAgentDeps {
  agentFactory: TobyAgentFactory;
  ledger: ChatLedgerPort;
  clock: Clock;
}

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { agentFactory, ledger, clock } = deps;

  const ledgerMonths = defineTool("read-only", {
    name: "ledger_months",
    label: "有记录的月份",
    description: "列出账本里有记录的月份,降序。",
    promptSnippet: "列出有记录的月份",
    promptGuidelines: ["查账前先看有哪些月份,再取该月明细。"],
    parameters: z.object({}).strict(),
    execute: async () => {
      const { months } = await ledger.months();
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
      .object({ month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/) })
      .strict(),
    execute: async (_toolCallId, params) => {
      const report = await ledger.monthReport(params.month);
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
    description: "取某一天的收支合计、分类小计和逐笔明细(金额为分)。",
    promptSnippet: "取某一天的账单明细",
    promptGuidelines: [
      "问「今天/昨天/某天」的收支时用它;date 按上下文里的今天换算成 YYYY-MM-DD。",
    ],
    parameters: z
      .object({ date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) })
      .strict(),
    execute: async (_toolCallId, params) => {
      const report = await ledger.dayReport(params.date);
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
    async run(prompt, history) {
      const now = new Date(clock());
      const agent = agentFactory({
        name: "chat-agent",
        preamble: "你是 Toby,一个私人助手,负责回答问题、查询数据和小聊。",
        rules: [
          "只用工具返回的真实数据回答,不编造;数据被截断就明说。",
          "用户要记账、记事、设日程时,温和地说明自己只负责查询,建议直接说那句话(比如「记午饭 30」),系统会自动路由。",
          "回答用简洁的中文。",
        ],
        context: [`今天是 ${localDayLabel(now)}。`],
        history,
        tools: [ledgerMonths, ledgerMonthReport, ledgerDay],
        policy: {
          allowedKinds: ["read-only"],
          maxTurns: CHAT_AGENT_MAX_TURNS,
        },
        maxTokens: CHAT_AGENT_MAX_TOKENS,
      });
      const result = await agent.run(prompt);
      return { text: result.text, messages: result.messages };
    },
  };
}
