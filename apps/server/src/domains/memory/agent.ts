/**
 * The memory agent: the explicit-sentence path (记住X / 忘掉X / 你记得我什么 /
 * 这通别记 — docs/decisions/personal-agent-memory.md, "How it is written").
 * A small tool-loop over the four memory tools; every landed change rides
 * back as a receipt, ambiguity turns into a clarifying question (never a
 * guess), and the run maps onto the chat capability's write outcome. The
 * `<memory>` section rides along so the agent sees conventions and the
 * index before acting; a corrupt file degrades to an honest line instead
 * of failing the sentence.
 */

import { type TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import type { ChatWriteOutcome } from "../../chat-capability.ts";
import { renderMemoryLine } from "./parser.ts";
import { createMemoryTools } from "./tools.ts";
import type { MemoryEntryView, MemoryReceipt, MemoryService } from "./types.ts";

// Bounded on purpose: an explicit memory sentence settles in one or two
// tool rounds; more means the model is wandering.
const MEMORY_AGENT_MAX_TURNS = 4;
const MEMORY_AGENT_MAX_TOKENS = 2000;

export interface MemoryAgentRun {
  readonly outcome: ChatWriteOutcome;
  /** Every memory change that landed during the run, in order. */
  readonly receipts: readonly MemoryReceipt[];
}

export interface MemoryAgent {
  run(sentence: string): Promise<MemoryAgentRun>;
}

/**
 * What the run produced, scanned off its own transcript: landed receipts
 * from remember/forget tool results, plus the verbatim lines of an
 * overview recall (a keyword-less call — the 你记得我什么 case), so the
 * card can list what was shown.
 */
function scanRun(messages: readonly unknown[]): {
  receipts: MemoryReceipt[];
  listed?: string[];
} {
  const receipts: MemoryReceipt[] = [];
  let listed: string[] | undefined;
  const overviewCallIds = new Set<string>();
  for (const message of messages) {
    const record = message as Record<string, unknown>;
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const block of record.content as Record<string, unknown>[]) {
        if (block.type !== "toolCall" || typeof block.id !== "string") {
          continue;
        }
        if (block.name === "recall") {
          const args = (block.arguments ?? {}) as { keyword?: unknown };
          const keyword =
            typeof args.keyword === "string" ? args.keyword.trim() : "";
          if (keyword.length === 0) {
            overviewCallIds.add(block.id);
          }
        }
      }
      continue;
    }
    if (record.role !== "toolResult") {
      continue;
    }
    const details = record.details as
      { receipt?: unknown; entries?: unknown } | undefined;
    if (
      (record.toolName === "remember" || record.toolName === "forget") &&
      details !== null &&
      typeof details === "object" &&
      details.receipt !== undefined &&
      details.receipt !== null
    ) {
      receipts.push(details.receipt as MemoryReceipt);
    }
    if (
      record.toolName === "recall" &&
      typeof record.toolCallId === "string" &&
      overviewCallIds.has(record.toolCallId) &&
      details !== null &&
      typeof details === "object" &&
      Array.isArray(details.entries)
    ) {
      const entries = details.entries as MemoryEntryView[];
      if (entries.length > 0) {
        listed = entries.map(renderMemoryLine);
      }
    }
  }
  return { receipts, ...(listed === undefined ? {} : { listed }) };
}

/** The confirmation copy when the model itself said nothing. */
function receiptSummary(receipts: readonly MemoryReceipt[]): string {
  return receipts
    .map((receipt) =>
      receipt.action === "remembered"
        ? `已记住：${receipt.after}`
        : receipt.action === "updated"
          ? `已更新：${receipt.after}`
          : `已清理：${receipt.before}`,
    )
    .join("；");
}

export function createMemoryAgent(deps: {
  agentFactory: TobyAgentFactory;
  service: MemoryService;
}): MemoryAgent {
  const { agentFactory, service } = deps;
  const tools = createMemoryTools({ service });
  return {
    async run(sentence) {
      const agent = agentFactory({
        name: "memory-agent",
        preamble: "你是 Toby 的记忆助手,直接执行用户关于记忆的那句话。",
        rules: [
          "「记住X」「记一下X」就把X写成一条记忆;若是在更正或替换已有的记忆,带上定位旧行的关键词。",
          "「忘掉X」就按关键词删掉那条记忆;命中多条时把候选原样列出来问用户是哪条,不要猜。",
          "「你记得我什么」就不带关键词翻出全部记忆,逐条照原文列出,不要概括、不要遗漏。",
          "「这通别记」就关掉本次对话的记录;「可以记了」「恢复记忆」就重新打开。",
          "除执行结果外不要编造记忆内容;回答用简洁的中文。",
        ],
        // Wrapped: a corrupt MEMORY.md degrades the section to an honest
        // line instead of failing the sentence.
        memory: async () => {
          try {
            return await service.buildMemorySection({
              conventions: true,
              peopleIndex: true,
              aboutIndex: true,
            });
          } catch {
            return "（记忆文件当前无法读取）";
          }
        },
        tools: [tools.recall, tools.remember, tools.forget, tools.offRecord],
        policy: {
          allowedKinds: ["read-only", "write-intent"],
          maxTurns: MEMORY_AGENT_MAX_TURNS,
        },
        maxTokens: MEMORY_AGENT_MAX_TOKENS,
      });

      const result = await agent.run(sentence);
      const { receipts, listed } = scanRun(result.producedMessages);
      const text = result.text.trim();

      if (receipts.length > 0) {
        const outcome: ChatWriteOutcome = {
          kind: "receipt",
          confirmText: text.length > 0 ? text : receiptSummary(receipts),
          receipt: { receipts, ...(listed === undefined ? {} : { listed }) },
        };
        return { outcome, receipts };
      }
      if (text.length === 0) {
        return {
          outcome: { kind: "notice", text: "这次没有需要改动的记忆。" },
          receipts,
        };
      }
      // A pending question ends the run as a clarifying question; anything
      // else is an honest notice.
      const outcome: ChatWriteOutcome = /[?？]\s*$/.test(text)
        ? { kind: "question", text }
        : { kind: "notice", text };
      return { outcome, receipts };
    },
  };
}
