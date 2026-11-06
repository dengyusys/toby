/**
 * Intent classification: one loop-free structured call per sentence
 * (docs/features/chat.md) through the single-shot `json()` entry — the
 * model returns a strict `{intent, sentence}` object; invalid output is
 * fed back once by the client's built-in correction retry, and a final
 * failure settles as an honest notice, never a 5xx. The classifier folds
 * follow-up fragments onto a self-contained sentence (it sees the recent
 * exchange history), and corrections about the previous turn re-classify
 * naturally — every message is classified fresh against that history.
 *
 * The valid intents are registry-derived: each registered capability
 * contributes its id and one prompt line (src/chat-capability.ts);
 * "none" is chat's own and always present. Unregistered intents are not
 * advertised — the classifier cannot return what it was never shown.
 */

import { z } from "zod";
import type { AiClient } from "../../infrastructure/model/types.ts";
import type { ChatIntent, IntentClassifier } from "./types.ts";

/** The registry slice the classifier needs: identity plus prompt line. */
export interface IntentDescriptor {
  readonly intent: ChatIntent;
  readonly intentDescription: string;
}

function classificationSchema(
  descriptors: readonly IntentDescriptor[],
): z.ZodType<{ intent: string; sentence: string }> {
  return z
    .object({
      intent: z.enum([
        "none",
        ...descriptors.map((descriptor) => descriptor.intent),
      ] as [string, ...string[]]),
      sentence: z.string().min(1),
    })
    .strict();
}

function systemPrompt(descriptors: readonly IntentDescriptor[]): string {
  return [
    "你是 Toby 的意图分类器。把用户当前这句话路由到一个意图,并把碎片补全成一句自含的话。",
    "意图说明:",
    ...descriptors.map((descriptor) => descriptor.intentDescription),
    "- none(其他):闲聊、提问、以及上面都不属于的话。",
    "规则:",
    "1. sentence 必须自含:用户当前这句是碎片(如「今天呀」「用微信」)时,结合最近对话把它补成完整、可独立理解的句子;是完整句则原样返回。",
    "2. 用户在纠正上一轮(如「不对,是打车」)时,把纠正后的完整意思放进 sentence。",
    '3. 只输出 JSON 对象:{"intent":"...","sentence":"..."},不要输出其他任何文字。',
  ].join("\n");
}

/** One exchange the classifier sees, newest last. */
const HISTORY_TURNS = 3;

export function createIntentClassifier(deps: {
  client: AiClient;
  /** The registered capabilities, in registration order. */
  intents: readonly IntentDescriptor[];
}): IntentClassifier {
  const { client } = deps;
  const schema = classificationSchema(deps.intents);
  const system = systemPrompt(deps.intents);
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
        [{ role: "system", content: system }, ...conversation],
        { maxTokens: 300 },
      );
      // json() already retried once with a correction prompt; anything
      // still failing validation is the caller's honest-fallback path.
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("classification output failed schema validation");
      }
      return parsed.data;
    },
  };
}
