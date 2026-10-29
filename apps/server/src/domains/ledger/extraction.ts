/**
 * Ledger extraction: the one-sentence AI path, run as a small tool-loop
 * agent (docs/decisions/ai-pi-runtime.md). The model either calls
 * submit_entries with a bounded entry batch or ask_user with one clarifying
 * question — the tool schemas are the model-facing contract, the shared
 * draft schema is the shape gate, and normalizeEntries stays the trust
 * boundary before any draft is captured. The prompt pins today's local
 * date for relative-date resolution and defaults a date-less sentence to
 * today; genuinely uncertain fields surface as a question instead of a
 * guess.
 */

import { z } from "zod";
import {
  defineTool,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import { LEDGER_ENTRIES_TOOL_SCHEMA } from "./schema.ts";
import type { LedgerEntry } from "./types.ts";
import { LedgerInputError, normalizeEntries } from "./validation.ts";

/** The AI could not resolve the sentence: ask the user one question. */
export interface LedgerFollowUp {
  readonly question: string;
}

export type LedgerDraft =
  { readonly entries: readonly LedgerEntry[] } | LedgerFollowUp;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function systemPrompt(now: Date): string {
  return [
    `你是记账助手。今天是 ${localDate(now)}(星期${WEEKDAYS[now.getDay()]})。`,
    "从用户的一句话里提取记账条目:能确定就调用 submit_entries 工具提交,单条也放进 entries 数组;",
    '"昨天"等相对说法按今天换算;未提及日期就是今天,直接填今天的日期,不要为此追问;用户未提及账户就省略 account 字段;note 尽量保留用户原话。',
    "「晚饭吃了8块」「打车15」「工资到账8000」这类说法已说清类型与去向:分别记作支出/餐饮、支出/交通、收入/工资,直接提交,不要追问分类;",
    "只有类型、金额或日期指代(如「那天」「记一笔8块」)真的无从判断时才调用 ask_user 工具,用一句中文向用户追问。",
    "除工具调用外不要输出正文。",
  ].join("\n");
}

/** Runs one extraction against a prepared agent. Domains inject a factory. */
export interface LedgerExtractor {
  extract(text: string, now: Date): Promise<LedgerDraft>;
}

// Bounded on purpose: 3 turns = first submit + one failed submit + one
// corrected resubmit — extraction settles in a single correction round.
const EXTRACTION_MAX_TURNS = 3;
// Sized for a 10-entry tool call with Chinese notes (~90 tokens each) plus
// structure overhead — 800 would truncate real multi-entry replies.
const EXTRACTION_MAX_TOKENS = 2000;

export function createLedgerExtractor(deps: {
  agentFactory: TobyAgentFactory;
}): LedgerExtractor {
  const { agentFactory } = deps;
  return {
    async extract(text, now) {
      // The draft lands here only through the tools below; whatever the
      // model submits passes normalizeEntries first — untrusted input,
      // same gate as the structured path. A rejection inside execute is
      // turned into an error tool result by pi-agent-core, which the model
      // can correct against.
      let draft: LedgerDraft | undefined;

      const submitEntries = defineTool("write-intent", {
        name: "submit_entries",
        label: "提交记账草稿",
        description:
          "提交从用户语句中提取的记账条目草稿。草稿进入待确认提案,不会直接写入账本。",
        parameters: LEDGER_ENTRIES_TOOL_SCHEMA,
        execute: async (_toolCallId, params) => {
          // Last write wins: a corrected resubmit replaces the earlier
          // draft; bounded by the turn cap so it cannot loop silently.
          draft = { entries: normalizeEntries(params.entries) };
          return {
            content: [
              {
                type: "text",
                text: `已记录 ${params.entries.length} 条草稿,等待用户确认。`,
              },
            ],
            details: { count: params.entries.length },
          };
        },
      });

      const askUser = defineTool("read-only", {
        name: "ask_user",
        label: "向用户追问",
        description:
          "仅当类型、金额或去向真的无从判断时使用;未提及日期不是追问理由(默认今天),晚饭/打车/工资等常见说法可自行判定,不要用本工具。",
        parameters: z.object({ question: z.string().min(1) }).strict(),
        execute: async (_toolCallId, params) => {
          const question = params.question.trim();
          // The schema only enforces minLength on the raw string; a blank
          // question bounces back like any other invalid draft.
          if (question.length === 0) {
            throw new LedgerInputError("question must not be empty");
          }
          draft = { question };
          return {
            content: [{ type: "text", text: "已把你的问题转达给用户。" }],
            details: {},
          };
        },
      });

      const agent = agentFactory({
        systemPrompt: systemPrompt(now),
        tools: [submitEntries, askUser],
        policy: {
          allowedKinds: ["read-only", "write-intent"],
          maxTurns: EXTRACTION_MAX_TURNS,
        },
        maxTokens: EXTRACTION_MAX_TOKENS,
      });

      const result = await agent.run(text);
      if (draft) {
        return draft;
      }
      if (result.turnCapped) {
        throw new AiError(
          "max-turns-exceeded",
          `extraction did not settle within ${EXTRACTION_MAX_TURNS} turns`,
        );
      }
      throw new AiError(
        "unparseable-output",
        "model finished without submitting entries or asking a question",
      );
    },
  };
}
