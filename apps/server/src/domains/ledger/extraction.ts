/**
 * Ledger extraction: the one-sentence AI path. The prompt pins today's
 * local date for relative-date resolution and demands strict JSON. The
 * model's output is untrusted input: it goes through the same
 * deterministic normalization as the structured path before any proposal
 * exists, and uncertain fields surface as one clarifying question instead
 * of a guess.
 */

import type { AiClient } from "../../infrastructure/ai/types.ts";
import type { LedgerEntry } from "./types.ts";
import { isRecord, LedgerInputError, normalizeEntries } from "./validation.ts";

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
    "从用户的一句话里提取记账条目,输出严格的 JSON,不要输出任何其他文字。",
    '多条时输出 {"entries": [...]},最多 10 条;单条也放进 entries 数组。',
    '每条的字段: date(YYYY-MM-DD,"昨天"等相对说法按今天换算)、type("expense" 或 "income")、category(分类,不超过 24 字)、account(账户,不超过 24 字,用户未提及就省略此字段)、amount(非负数字符串,最多两位小数)、note(备注,可空字符串,尽量保留用户原话)。',
    '日期、类型或金额不确定时不要猜:输出 {"question": "一个中文追问"}。',
  ].join("\n");
}

export async function extractLedgerEntries(
  ai: AiClient,
  text: string,
  deps: { now?: () => Date } = {},
): Promise<LedgerDraft> {
  const now = deps.now ?? (() => new Date());
  const output = await ai.json(
    [
      { role: "system", content: systemPrompt(now()) },
      { role: "user", content: text },
    ],
    // Sized for a 10-entry reply with Chinese notes (~90 tokens each) plus
    // structure overhead — 800 truncated real multi-entry extractions.
    { maxTokens: 2000 },
  );
  if (isRecord(output)) {
    const question = output.question;
    if (typeof question === "string" && question.trim().length > 0) {
      return { question: question.trim() };
    }
    if (Array.isArray(output.entries)) {
      // Bad AI output dies here: same validation as the structured path,
      // zero proposals, zero writes.
      return { entries: normalizeEntries(output.entries) };
    }
  }
  throw new LedgerInputError(
    'AI output must be {"entries": [...]} or {"question": "..."}',
  );
}
