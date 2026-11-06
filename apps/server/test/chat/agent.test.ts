/**
 * The chat agent's prompt: the runtime renders it from the spec — preamble,
 * generated <tools> lines, domain rules, then the per-run <context>. Tool
 * names appear only in the generated section; the hand-written parts carry
 * behaviour, so a renamed tool cannot leave a stale name in prose.
 */

import { describe, expect, it } from "vitest";
import { createChatAgent } from "../../src/domains/chat/agent.ts";
import type { ChatLedgerPort } from "../../src/domains/chat/types.ts";
import type {
  TobyAgentFactory,
  TobyAgentSpec,
} from "../../src/infrastructure/model/agent.ts";
import { buildSystemPrompt } from "../../src/infrastructure/model/prompt.ts";

const specs: TobyAgentSpec[] = [];

const agentFactory: TobyAgentFactory = (spec) => {
  specs.push(spec);
  return {
    async run() {
      return {
        text: "ok",
        turns: 1,
        turnCapped: false,
        stopReason: "stop" as const,
        messages: [],
      };
    },
  };
};

const ledger: ChatLedgerPort = {
  recordFromText: async () => ({ question: "记成哪一类?" }),
  months: async () => ({ months: ["2026-11"] }),
  monthReport: async () => ({
    month: "2026-11",
    income_total: 0,
    expense_total: 0,
    categories: [],
    transactions: [],
  }),
  dayReport: async () => ({
    date: "2026-11-06",
    income_total: 0,
    expense_total: 0,
    categories: [],
    transactions: [],
  }),
};

const clock = () => new Date(2026, 10, 6, 12, 0, 0).getTime();

describe("createChatAgent", () => {
  it("renders the tools section from the tool definitions", async () => {
    specs.length = 0;
    const agent = createChatAgent({ agentFactory, ledger, clock });
    await agent.run("查一下 11 月的账", []);

    const spec = specs[0]!;
    expect(spec.tools.map((entry) => entry.tool.name)).toEqual([
      "ledger_months",
      "ledger_month_report",
      "ledger_day",
    ]);

    const prompt = buildSystemPrompt(spec);
    expect(prompt).toContain("- ledger_months：列出有记录的月份");
    expect(prompt).toContain("- ledger_month_report：取某个月的账单明细");
    expect(prompt).toContain("- ledger_day：取某一天的账单明细");
    // The ordering note rides under the tool that starts the chain.
    expect(prompt).toContain(
      "<tools>\n- ledger_months：列出有记录的月份\n  - 查账前先看有哪些月份,再取该月明细。",
    );
    expect(prompt).toContain("<rules>");
    expect(prompt).toContain(
      "<context>\n今天是 2026-11-06(星期五)。\n</context>",
    );

    // Hand-written sections never name a tool; <tools> is the one place
    // that does, and it is generated.
    const prose = [
      spec.preamble,
      ...(spec.rules ?? []),
      ...(spec.context ?? []),
    ].join("\n");
    for (const entry of spec.tools) {
      expect(prose).not.toContain(entry.tool.name);
    }
  });
});
