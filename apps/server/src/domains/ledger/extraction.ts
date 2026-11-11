/**
 * Ledger extraction: the one-sentence AI path, run as a small tool-loop
 * agent (docs/decisions/ai-pi-runtime.md). The model either calls
 * submit_entries with a bounded entry batch, submit_edit with a
 * match+patch correction of a stored transaction, or ask_user with one
 * clarifying question — the tool schemas are the model-facing contract,
 * the shared draft and patch schemas are the shape gate, and the
 * normalize* functions stay the trust boundary before any draft is
 * captured. The prompt pins today's local date for relative-date
 * resolution and defaults a date-less sentence to today; genuinely
 * uncertain fields surface as a question instead of a guess.
 */

import { z } from "zod";
import {
  defineTool,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import { localDayLabel } from "../../infrastructure/local-date.ts";
import {
  LEDGER_EDIT_TOOL_SCHEMA,
  LEDGER_ENTRIES_TOOL_SCHEMA,
} from "./schema.ts";
import type { LedgerEditInstruction, LedgerEntry } from "./types.ts";
import {
  LedgerInputError,
  normalizeEditMatch,
  normalizeEntries,
  normalizeEntryPatch,
} from "./validation.ts";

/** The AI could not resolve the sentence: ask the user one question. */
export interface LedgerFollowUp {
  readonly question: string;
}

export type LedgerDraft =
  | { readonly entries: readonly LedgerEntry[] }
  | { readonly edit: LedgerEditInstruction }
  | LedgerFollowUp;

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
        label: "提交记账条目",
        description: "提交从用户语句中提取的记账条目。通过校验后立即写入账本。",
        promptSnippet: "提交记账条目(立即写入)",
        promptGuidelines: ["能确定就直接提交,单条也放进 entries 数组。"],
        parameters: LEDGER_ENTRIES_TOOL_SCHEMA,
        execute: async (_toolCallId, params) => {
          // Last write wins: a corrected resubmit replaces the earlier
          // draft; bounded by the turn cap so it cannot loop silently.
          draft = { entries: normalizeEntries(params.entries) };
          return {
            content: [
              {
                type: "text",
                text: `已提交 ${params.entries.length} 条,立即记入账本。`,
              },
            ],
            details: { count: params.entries.length },
          };
        },
      });

      const askUser = defineTool("read-only", {
        name: "ask_user",
        label: "向用户追问",
        description: "向用户提一个澄清问题;本次提取以这个问题结束。",
        promptSnippet: "向用户追问一个问题",
        promptGuidelines: [
          "只有类型、金额或日期指代真的无从判断时才用本工具,用一句中文提一个问题。",
        ],
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

      const submitEdit = defineTool("write-intent", {
        name: "submit_edit",
        label: "提交账目修改",
        description:
          "提交对已记一笔账的修改:match 用日期/类型/分类/备注关键词定位那笔记录,patch 只给要改的字段。定位唯一并校验通过后立即写入。",
        promptSnippet: "修改已记的账(立即写入)",
        promptGuidelines: [
          "用户在纠正或修改已记的账(如「把昨天午饭那笔改成 35」「不对,是打车」)时用本工具,而不是再记一笔。",
        ],
        parameters: LEDGER_EDIT_TOOL_SCHEMA,
        execute: async (_toolCallId, params) => {
          // Same gate as submit_entries: untrusted input, deterministic
          // normalization, last write wins under the turn cap.
          draft = {
            edit: {
              match: normalizeEditMatch(params.match),
              patch: normalizeEntryPatch(params.patch),
            },
          };
          return {
            content: [
              {
                type: "text" as const,
                text: "已提交修改;唯一定位那笔记录后立即写入。",
              },
            ],
            details: {},
          };
        },
      });

      const agent = agentFactory({
        name: "ledger-extraction",
        preamble: "你是记账助手。把用户的一句话变成记账条目。",
        rules: [
          '"昨天"等相对说法按今天换算;未提及日期就是今天,直接填今天的日期,不要为此追问。',
          "用户未提及账户就省略 account 字段;note 一般省略,不要把用户原话复述进 note,仅当用户明确补充了备注信息(如「要报销」)才填写。",
          "「晚饭吃了8块」「打车15」「工资到账8000」这类说法已说清类型与去向:分别记作支出/餐饮、支出/交通、收入/工资,直接提交,不要追问分类。",
          "用户纠正或修改已记的账(如「不对,是打车」「把昨天午饭那笔改成 35」)时,提交的是修改而不是新条目;说不清要改哪笔就先追问。",
          "除工具调用外不要输出正文。",
        ],
        context: [`今天是 ${localDayLabel(now)}。`],
        tools: [submitEntries, submitEdit, askUser],
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
