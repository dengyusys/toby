/**
 * Schedule extraction: the one-sentence AI path, run as a small tool-loop
 * agent (docs/decisions/ai-pi-runtime.md), mirroring the ledger's
 * architecture. The model reads the registered items (titles, status
 * vocabularies) through the read tools, then either submits writes —
 * put (itemId, date, status) or clear (itemId, date) — or outputs one
 * clarifying question as its final text; there is no dedicated ask
 * tool, so "no writes and a final sentence" IS the question channel.
 * Item management (create/rename/delete, vocabulary edits) has no tool
 * definition at all: an unknown item or status surfaces as a question
 * pointing at the UI, never an invented item. The tool schemas are the
 * model-facing contract; normalizeEntryPut / parseScheduleDate stay the
 * trust boundary before anything is captured, and the writes themselves
 * land after the run, through the service's validated transactional
 * path — one ambiguity anywhere asks and lands nothing. The prompt pins
 * today's local date for relative-date resolution (未提及日期就是今天).
 * With the memory port wired, the conversational memory tools ride
 * along (silent learning, docs/decisions/personal-agent-memory.md) and
 * the landed memory receipts travel back on the draft.
 */

import {
  defineTool,
  type TobyAgentFactory,
  type TobyTool,
} from "../../infrastructure/model/agent.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import { localDayLabel } from "../../infrastructure/local-date.ts";
import {
  SCHEDULE_CLEAR_TOOL_SCHEMA,
  SCHEDULE_ENTRIES_TOOL_SCHEMA,
  SCHEDULE_ITEMS_TOOL_SCHEMA,
  SCHEDULE_PUT_TOOL_SCHEMA,
} from "./schema.ts";
import type { ScheduleEntryView, ScheduleItemRow } from "./types.ts";
import { normalizeEntryPut, parseScheduleDate } from "./validation.ts";

/** The AI could not resolve the sentence: ask the user one question. */
export interface ScheduleFollowUp {
  readonly question: string;
}

/** One captured write op: a put or a clear for one natural key. */
export type ScheduleOp =
  | {
      readonly kind: "put";
      readonly itemId: number;
      readonly date: string;
      readonly status: string;
    }
  | { readonly kind: "clear"; readonly itemId: number; readonly date: string };

/**
 * The extraction draft: the captured ops (at most one per (itemId,
 * date) — the last submit for a key wins) or one clarifying question,
 * optionally carrying the memory receipts that landed mid-run (opaque
 * passthrough, the schedule never reads them).
 */
export type ScheduleDraft =
  | {
      readonly ops: readonly ScheduleOp[];
      readonly memoryReceipts?: readonly unknown[];
    }
  | ScheduleFollowUp;

/**
 * The reads the extraction agent's read tools serve: the plugin binds
 * them to the repository (resolveRange included), the chat capability
 * binds them to the service. A wiring seam inside the domain — never a
 * second construction of the domain's rules.
 */
export interface ScheduleExtractionReads {
  listItems(): Promise<readonly ScheduleItemRow[]>;
  listEntries(from: string, to: string): Promise<readonly ScheduleEntryView[]>;
}

/**
 * The memory wiring port (docs/decisions/personal-agent-memory.md): the
 * whole-book `<memory>` section plus the shared conversational memory
 * tools. A wiring port, not a domain import — the composition root
 * binds the memory service to it.
 */
export interface ScheduleMemoryPort {
  /** The whole book, resolved fresh per run. */
  sectionFor(): Promise<string>;
  readonly tools: readonly TobyTool[];
}

/** Runs one extraction against a prepared agent. Domains inject a factory. */
export interface ScheduleExtractor {
  extract(text: string, now: Date): Promise<ScheduleDraft>;
}

/**
 * The two read tools, shared by the schedule extraction agent (which
 * must map the user's words to item ids and check vocabularies) and the
 * none agent (which answers schedule questions). Built over the reads
 * port, so both agents see the same rendering.
 */
export function createScheduleReadTools(
  reads: ScheduleExtractionReads,
): [TobyTool, TobyTool] {
  const scheduleItems = defineTool("read-only", {
    name: "schedule_items",
    label: "事项列表",
    description: "列出日程的全部事项:id、标题、各自的状态词表和已记录天数。",
    promptSnippet: "列出日程事项及其状态词表",
    promptGuidelines: [
      "先看事项和各自的状态词表,再把用户说的名称对应到 id;没有对应事项就追问一句,让用户先在界面里创建,绝不编造事项或状态。",
    ],
    parameters: SCHEDULE_ITEMS_TOOL_SCHEMA,
    execute: async () => {
      const items = await reads.listItems();
      const text =
        items.length === 0
          ? "还没有任何事项。"
          : [
              `共 ${items.length} 个事项:`,
              ...items.map(
                (item) =>
                  `${item.id}. ${item.title}:${item.statuses.join("、")}(已记录 ${item.entryCount} 天)`,
              ),
            ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { items },
      };
    },
  });

  const scheduleEntries = defineTool("read-only", {
    name: "schedule_entries",
    label: "区间记录",
    description: "取某段时间(两端含)内所有事项的每日记录。",
    promptSnippet: "取某段时间的每日记录",
    promptGuidelines: [
      "问「这周/最近」某事项记了几天时用它;from/to 按上下文里的今天换算成 YYYY-MM-DD,区间含两端。",
    ],
    parameters: SCHEDULE_ENTRIES_TOOL_SCHEMA,
    execute: async (_toolCallId, params) => {
      const entries = await reads.listEntries(params.from, params.to);
      const lines = entries.map(
        (entry) => `${entry.date} ${entry.title}:${entry.status}`,
      );
      const text =
        lines.length === 0
          ? `${params.from} ~ ${params.to} 没有任何记录。`
          : [
              ...lines.slice(0, 30),
              ...(lines.length > 30
                ? [`(仅显示前 30 条,共 ${lines.length} 条)`]
                : []),
            ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { from: params.from, to: params.to, count: entries.length },
      };
    },
  });

  return [scheduleItems, scheduleEntries];
}

/**
 * Memory receipts off the run's own transcript: the remember/forget tool
 * results' details.receipt, in call order. Opaque passthrough — the
 * schedule copies them onto its write result; it never reads them.
 */
function memoryReceiptsOf(messages: readonly unknown[]): readonly unknown[] {
  const receipts: unknown[] = [];
  for (const message of messages) {
    const record = message as Record<string, unknown>;
    if (record.role !== "toolResult") {
      continue;
    }
    if (record.toolName !== "remember" && record.toolName !== "forget") {
      continue;
    }
    const details = record.details as { receipt?: unknown } | undefined;
    if (
      details !== null &&
      typeof details === "object" &&
      details.receipt !== undefined &&
      details.receipt !== null
    ) {
      receipts.push(details.receipt);
    }
  }
  return receipts;
}

// Bounded on purpose: 4 turns = read the items + one multi-call submit +
// one corrected resubmit — extraction settles in a single correction
// round even when the sentence names several items.
const EXTRACTION_MAX_TURNS = 4;
// Sized for a three-put turn plus a read round and structure overhead —
// the ledger's reasoning applies unchanged.
const EXTRACTION_MAX_TOKENS = 2000;

export function createScheduleExtractor(deps: {
  agentFactory: TobyAgentFactory;
  /** The read tools' data seam; the plugin binds the repository. */
  reads: ScheduleExtractionReads;
  /** The memory wiring port; absent memory leaves the agent unchanged. */
  memory?: ScheduleMemoryPort;
}): ScheduleExtractor {
  const { agentFactory, reads } = deps;
  const memory = deps.memory;
  return {
    async extract(text, now) {
      // The draft lands here only through the write tools below; whatever
      // the model submits passes normalizeEntryPut / parseScheduleDate
      // first — untrusted input, same gate as the HTTP path. A rejection
      // inside execute is turned into an error tool result by
      // pi-agent-core, which the model can correct against.
      const ops = new Map<string, ScheduleOp>();

      const putEntry = defineTool("write-intent", {
        name: "schedule_put",
        label: "提交状态记录",
        description:
          "提交某事项某一天的状态(itemId 从事项列表来,status 用该事项词表里的原词)。通过校验后立即写入。",
        promptSnippet: "提交某事项某天的状态(立即写入)",
        promptGuidelines: [
          "用户说清的每个事项各提交一条;能确定就直接提交,词表内的状态不要追问。",
        ],
        parameters: SCHEDULE_PUT_TOOL_SCHEMA,
        execute: async (_toolCallId, params) => {
          // Real-calendar date, trimmed status bounds — the same gate the
          // HTTP write path uses. Vocabulary membership rides later, in
          // the write transaction itself.
          const entry = normalizeEntryPut(params);
          // One op per natural key; a corrected resubmit replaces the
          // earlier capture — last write wins.
          ops.set(`${entry.itemId}|${entry.date}`, {
            kind: "put",
            itemId: entry.itemId,
            date: entry.date,
            status: entry.status,
          });
          return {
            content: [
              {
                type: "text",
                text: "已提交 1 条;这句话的提交全部结束后统一写入。",
              },
            ],
            details: { count: ops.size },
          };
        },
      });

      const clearEntry = defineTool("write-intent", {
        name: "schedule_clear",
        label: "提交清除记录",
        description:
          "清除某事项某一天的记录(itemId 从事项列表来)。通过校验后立即写入。",
        promptSnippet: "清除某事项某天的记录(立即写入)",
        promptGuidelines: [
          "只有用户明确要删掉某天的记录才用;「没吃」「没做」是记录一个状态,不是清除。",
        ],
        parameters: SCHEDULE_CLEAR_TOOL_SCHEMA,
        execute: async (_toolCallId, params) => {
          const date = parseScheduleDate(params.date, "date");
          ops.set(`${params.itemId}|${date}`, {
            kind: "clear",
            itemId: params.itemId,
            date,
          });
          return {
            content: [
              {
                type: "text",
                text: "已提交清除;这句话的提交全部结束后统一写入。",
              },
            ],
            details: { count: ops.size },
          };
        },
      });

      const [scheduleItems, scheduleEntries] = createScheduleReadTools(reads);

      // The whole-book `<memory>` section, resolved per run
      // (docs/decisions/personal-agent-memory.md); a corrupt memory file
      // degrades to one honest line instead of failing the extraction.
      const memorySection =
        memory === undefined
          ? undefined
          : async (): Promise<string> => {
              const port = memory;
              try {
                return await port.sectionFor();
              } catch {
                return "（记忆文件当前无法读取）";
              }
            };

      const agent = agentFactory({
        name: "schedule-extraction",
        preamble:
          "你是 Toby 的日程助手。把用户的一句话变成每日事项的状态记录。",
        rules: [
          "「昨天」「明天」等相对说法按今天换算;未提及日期就是今天,直接填今天的日期,不要为此追问。",
          "先用事项列表看清各事项的标题和状态词表,再把用户说的名称对应到 itemId;对不上或状态不在词表里,就如实追问一句,请用户在界面里先创建事项或对照词表,绝不编造事项或状态。",
          "一句话说清多个事项(如早饭、中饭、晚饭)时逐条提交;同一事项同一日期重复提交时,以后一次为准。",
          "只有用户明确要删掉某天的记录才清除;「没吃」「没做」是记录状态,不是清除。",
          "要么调用工具完成记录,要么输出一句中文追问;不要输出其他正文,也不要在没写入时声称已写入。",
        ],
        context: [`今天是 ${localDayLabel(now)}。`],
        ...(memorySection === undefined ? {} : { memory: memorySection }),
        tools: [
          scheduleItems,
          scheduleEntries,
          putEntry,
          clearEntry,
          ...(memory?.tools ?? []),
        ],
        policy: {
          allowedKinds: ["read-only", "write-intent"],
          maxTurns: EXTRACTION_MAX_TURNS,
        },
        maxTokens: EXTRACTION_MAX_TOKENS,
      });

      const result = await agent.run(text);
      if (ops.size > 0) {
        const captured = [...ops.values()];
        const memoryReceipts = memoryReceiptsOf(result.producedMessages);
        return memoryReceipts.length > 0
          ? { ops: captured, memoryReceipts }
          : { ops: captured };
      }
      if (result.turnCapped) {
        throw new AiError(
          "max-turns-exceeded",
          `extraction did not settle within ${EXTRACTION_MAX_TURNS} turns`,
        );
      }
      // No dedicated ask tool: the model's final text IS the question
      // channel (the rules forbid any other prose, in particular claiming
      // a write that never happened).
      const question = result.text.trim();
      if (question.length > 0) {
        return { question };
      }
      throw new AiError(
        "unparseable-output",
        "model finished without submitting entries or asking a question",
      );
    },
  };
}
