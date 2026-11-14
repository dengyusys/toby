/**
 * The memory tools (docs/decisions/personal-agent-memory.md, "How it is
 * written"): remember / forget / off_record, all write-intent. Every
 * conversational agent carries remember + forget — silent learning rides
 * whichever agent is already running — while off_record exists for the
 * explicit 这通别记 / 可以记了 sentences and stays on the memory domain's
 * own agent only. There is no recall: the whole book rides in every
 * prompt, so there is nothing to fetch. The off-record gate is checked
 * on the tool, not on which agent calls it; off_record itself is never
 * gated (turning the flag back off must always work).
 *
 * One instance set serves every consumer (chat capability, ledger
 * extractor, memory agent): the gate and the receipts stay consistent
 * because they all close over the same service.
 */

import { z } from "zod";
import { defineTool } from "../../infrastructure/model/agent.ts";
import type { TobyTool } from "../../infrastructure/model/agent.ts";
import { MEMORY_SECTION_MAX_CHARS, isValidMemoryDate } from "./parser.ts";
import type { MemoryService } from "./types.ts";

/** The off-record copy, shared by both write tools' gate. */
const OFF_RECORD_REFUSAL = "本通对话设置了不记忆，这次不记。";

/** The candidates as one model-facing line: ask, never guess. */
function ambiguousText(candidates: readonly string[]): string {
  return `匹配到 ${candidates.length} 条记忆，说不清是哪条，先向用户问清楚：${candidates.join("；")}`;
}

/** An error tool result: the model sees the text as a failure to correct. */
function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    isError: true,
  };
}

/** The shared off-record gate: session-free by design (see file comment). */
function offRecordRefusal(service: MemoryService) {
  if (!service.getOffRecord().on) {
    return undefined;
  }
  return errorResult(OFF_RECORD_REFUSAL);
}

export interface MemoryTools {
  readonly remember: TobyTool;
  readonly forget: TobyTool;
  readonly offRecord: TobyTool;
}

export function createMemoryTools(deps: {
  service: MemoryService;
}): MemoryTools {
  const { service } = deps;

  const remember = defineTool("write-intent", {
    name: "remember",
    label: "写记忆",
    description:
      "把一条记忆写进记忆文件的某个小节(section),带 replaceKeyword 时替换定位到的那条旧行。",
    promptSnippet: "把一条事实或约定记进记忆",
    promptGuidelines: [
      "对话里出现值得长期记住的事实、约定或更正时用它,一条记忆一句话。",
      "section 优先用记忆里已有的、这条明确属于的小节;确实都不合适才开新小节;用户明确指定了小节(如记到「工作」里)时照办。",
      "更正已有记忆时给 replaceKeyword 定位旧行,让新内容替换旧行而不是并存。",
    ],
    parameters: z
      .object({
        section: z.string().min(1).max(MEMORY_SECTION_MAX_CHARS),
        text: z.string().min(1),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(isValidMemoryDate, "until must be a real calendar date")
          .optional(),
        replaceKeyword: z.string().min(1).optional(),
      })
      .strict(),
    execute: async (_toolCallId, params) => {
      const refusal = offRecordRefusal(service);
      if (refusal !== undefined) {
        return refusal;
      }
      const result = await service.remember({
        section: params.section,
        text: params.text,
        ...(params.until === undefined ? {} : { until: params.until }),
        ...(params.replaceKeyword === undefined
          ? {}
          : { replaceKeyword: params.replaceKeyword }),
      });
      switch (result.kind) {
        case "receipt": {
          const text =
            result.receipt.action === "remembered"
              ? `已记住：${result.receipt.after}`
              : `已更新：${result.receipt.after}`;
          return {
            content: [{ type: "text" as const, text }],
            details: { receipt: result.receipt },
          };
        }
        case "already-remembered":
          return {
            content: [
              { type: "text" as const, text: `已记得：${result.line}` },
            ],
            details: {},
          };
        case "ambiguous":
          return errorResult(ambiguousText(result.candidates));
        case "nothing-matched":
          // Unreachable for remember (a replace miss appends as new);
          // kept for exhaustiveness.
          return {
            content: [{ type: "text" as const, text: "没有相关记忆" }],
            details: {},
          };
      }
    },
  });

  const forget = defineTool("write-intent", {
    name: "forget",
    label: "忘掉记忆",
    description:
      "按关键词删除一条不再成立的记忆；命中多行时会列出候选，命中为零时如实回答。",
    promptSnippet: "删掉一条不再成立的记忆",
    promptGuidelines: [
      "keyword 是子串匹配,对所有未过期记忆的正文生效;命中多行时把候选列给用户确认,不要猜。",
    ],
    parameters: z.object({ keyword: z.string().min(1) }).strict(),
    execute: async (_toolCallId, params) => {
      const refusal = offRecordRefusal(service);
      if (refusal !== undefined) {
        return refusal;
      }
      const result = await service.forget(params.keyword);
      switch (result.kind) {
        case "receipt":
          return {
            content: [
              {
                type: "text" as const,
                text: `已清理：${result.receipt.before}`,
              },
            ],
            details: { receipt: result.receipt },
          };
        case "ambiguous":
          return errorResult(ambiguousText(result.candidates));
        case "nothing-matched":
          return {
            content: [{ type: "text" as const, text: "没有相关记忆" }],
            details: {},
          };
        case "already-remembered":
          // Unreachable for forget; kept for exhaustiveness.
          return {
            content: [
              { type: "text" as const, text: `已记得：${result.line}` },
            ],
            details: {},
          };
      }
    },
  });

  const offRecord = defineTool("write-intent", {
    name: "off_record",
    label: "本通不记忆",
    description:
      "打开或关闭本通对话的记录开关；关闭后这次对话不再写入任何记忆，重新打开即恢复。",
    promptSnippet: "开关本通对话的记忆",
    promptGuidelines: ["用户说这通不要记时关闭,说可以记了或恢复时打开。"],
    parameters: z.object({ on: z.boolean() }).strict(),
    execute: async (_toolCallId, params) => {
      // Deliberately never gated by the flag itself: turning it back off
      // (and on) must always work — this tool is how the flag is set.
      service.setOffRecord(params.on);
      return {
        content: [
          {
            type: "text" as const,
            text: params.on ? "好，这通不记了。" : "好，恢复正常记忆。",
          },
        ],
        details: { on: params.on },
      };
    },
  });

  return { remember, forget, offRecord };
}
