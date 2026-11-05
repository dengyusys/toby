/**
 * Intent classification: one loop-free structured call per sentence
 * (docs/features/chat.md) through the single-shot `json()` entry — the
 * model returns a strict `{intent, sentence}` object; invalid output is
 * fed back once by the client's built-in correction retry, and a final
 * failure settles as an honest notice, never a 5xx. The classifier folds
 * follow-up fragments onto a self-contained sentence (it sees the recent
 * exchange history), and corrections about the previous turn re-classify
 * naturally — every message is classified fresh against that history.
 */

import { z } from "zod";
import type { AiClient } from "../../infrastructure/model/types.ts";
import type { ChatIntent, IntentClassifier } from "./types.ts";

const INTENTS: readonly ChatIntent[] = [
  "ledger",
  "schedule",
  "memory",
  "notes",
  "todo",
  "none",
];

const CLASSIFICATION_SCHEMA = z
  .object({
    intent: z.enum(INTENTS as [ChatIntent, ...ChatIntent[]]),
    sentence: z.string().min(1),
  })
  .strict();

const SYSTEM_PROMPT = [
  "你是 Toby 的意图分类器。把用户当前这句话路由到一个意图,并把碎片补全成一句自含的话。",
  "意图说明:",
  "- ledger(记账):记一笔钱、查账、问花了多少。",
  "- schedule(日程):安排、提醒、追踪某件事的日程。",
  "- memory(记忆):让助手记住或回忆长期偏好、事实。",
  "- notes(手账):随手记的想法、决心、备忘文字。",
  "- todo(待办):把一件事放到告示板。",
  "- none(其他):闲聊、提问、以及上面都不属于的话。",
  "规则:",
  "1. sentence 必须自含:用户当前这句是碎片(如「今天呀」「用微信」)时,结合最近对话把它补成完整、可独立理解的句子;是完整句则原样返回。",
  "2. 用户在纠正上一轮(如「不对,是打车」)时,把纠正后的完整意思放进 sentence。",
  '3. 只输出 JSON 对象:{"intent":"...","sentence":"..."},不要输出其他任何文字。',
].join("\n");

/** One exchange the classifier sees, newest last. */
const HISTORY_TURNS = 3;

export function createIntentClassifier(deps: {
  client: AiClient;
}): IntentClassifier {
  const { client } = deps;
  return {
    async classify(text, history) {
      const recent = history.slice(-HISTORY_TURNS);
      const conversation = [
        ...(recent.length > 0
          ? [
              {
                role: "user" as const,
                content: `【最近对话,仅供理解,不是当前这句】\n${recent
                  .map((turn) => `用户:${turn.user}\n助手:${turn.reply}`)
                  .join("\n")}`,
              },
              {
                role: "assistant" as const,
                content: "收到,我只把它当上下文。请给出当前这句话。",
              },
            ]
          : []),
        { role: "user" as const, content: `【当前这句】\n${text}` },
      ];
      const raw = await client.json(
        [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
        { maxTokens: 300 },
      );
      // json() already retried once with a correction prompt; anything
      // still failing validation is the caller's honest-fallback path.
      const parsed = CLASSIFICATION_SCHEMA.safeParse(raw);
      if (!parsed.success) {
        throw new Error("classification output failed schema validation");
      }
      return parsed.data;
    },
  };
}
