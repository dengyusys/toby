/**
 * Schedule extraction against a scripted fake agent factory: the four
 * tools (two read, two write — nothing else exists), the validation
 * gate in the loop (fake calendar dates bounce, the model corrects),
 * last-write-wins per natural key, the final-text question channel, the
 * turn cap, and the prompt's pinned local date. Mirrors the ledger
 * extraction suite; the fake loop replays the real loop's contract:
 * tool executes run in order, thrown errors become model-visible
 * failures, and the run ends after the scripted steps.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createScheduleExtractor,
  type ScheduleDraft,
  type ScheduleExtractionReads,
  type ScheduleMemoryPort,
} from "../../src/domains/schedule/extraction.ts";
import {
  SCHEDULE_CLEAR_TOOL_SCHEMA,
  SCHEDULE_ENTRIES_TOOL_SCHEMA,
  SCHEDULE_ITEMS_TOOL_SCHEMA,
  SCHEDULE_PUT_TOOL_SCHEMA,
} from "../../src/domains/schedule/schema.ts";
import type { ScheduleItemRow } from "../../src/domains/schedule/types.ts";
import { createMemoryTools } from "../../src/domains/memory/tools.ts";
import type {
  MemoryService,
  MemoryWriteResult,
} from "../../src/domains/memory/types.ts";
import { buildSystemPrompt } from "../../src/infrastructure/model/prompt.ts";
import type {
  TobyAgent,
  TobyAgentFactory,
  TobyAgentRunResult,
  TobyAgentSpec,
  TobyTool,
} from "../../src/infrastructure/model/agent.ts";
import { AiError } from "../../src/infrastructure/model/errors.ts";
import { caughtAiError } from "../helpers.ts";

/**
 * The arguments each tool's schema accepts: the fake loop rejects a call the
 * runtime would too, by checking the Zod schema that produced the JSON Schema.
 */
const TOOL_ARGUMENT_SCHEMAS: Record<string, z.ZodType> = {
  schedule_items: SCHEDULE_ITEMS_TOOL_SCHEMA,
  schedule_entries: SCHEDULE_ENTRIES_TOOL_SCHEMA,
  schedule_put: SCHEDULE_PUT_TOOL_SCHEMA,
  schedule_clear: SCHEDULE_CLEAR_TOOL_SCHEMA,
};

/** One scripted model action in the fake loop. */
type Step =
  { readonly tool: string; readonly args: unknown } | { readonly text: string };

function makeFakeFactory(steps: readonly Step[]) {
  const specs: TobyAgentSpec[] = [];
  const prompts: string[] = [];
  const factory: TobyAgentFactory = (spec) => {
    specs.push(spec);
    const toolsByName = new Map<string, TobyTool>(
      spec.tools.map((entry) => [entry.tool.name, entry] as const),
    );
    const agent: TobyAgent = {
      async run(prompt: string): Promise<TobyAgentRunResult> {
        prompts.push(prompt);
        let turnCapped = false;
        for (const step of steps) {
          turnCapped = false;
          if ("text" in step) {
            return {
              text: step.text,
              turns: steps.indexOf(step) + 1,
              turnCapped,
              stopReason: "stop",
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              // Extraction reads receipts off the transcript; the plain
              // loop carries none, the memory-aware one below does.
              messages: [],
              producedMessages: [],
            };
          }
          const entry = toolsByName.get(step.tool);
          if (!entry) {
            throw new Error(`fake loop: unregistered tool ${step.tool}`);
          }
          // Mirrors the real runtime: schema-invalid arguments become a
          // model-visible error and execute never runs.
          if (!TOOL_ARGUMENT_SCHEMAS[step.tool]?.safeParse(step.args).success) {
            continue;
          }
          try {
            await entry.tool.execute("fake-call", step.args as never);
          } catch {
            // Mirrors the real loop: execute errors (validation semantics)
            // become model-visible tool failures and the loop continues.
          }
        }
        // Script exhausted without settling: report as turn-capped (the
        // fake has no real policy loop; only the max-turns test asserts it).
        turnCapped = true;
        return {
          text: "",
          turns: steps.length,
          turnCapped,
          stopReason: "stop",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          messages: [],
          producedMessages: [],
        };
      },
    };
    return agent;
  };
  return { factory, specs, prompts };
}

/** An in-memory reads port; records the calls the tools made. */
function makeReads(items: readonly ScheduleItemRow[] = []) {
  const itemCalls: number[] = [];
  const rangeCalls: string[] = [];
  const reads: ScheduleExtractionReads = {
    listItems: async () => {
      itemCalls.push(1);
      return items;
    },
    listEntries: async (from, to) => {
      rangeCalls.push(`${from}..${to}`);
      return [];
    },
  };
  return {
    reads,
    itemCallsOf: () => itemCalls,
    rangeCallsOf: () => rangeCalls,
  };
}

function makeExtractor(
  steps: readonly Step[],
  items: readonly ScheduleItemRow[] = [],
) {
  const { factory, specs, prompts } = makeFakeFactory(steps);
  const { reads, itemCallsOf, rangeCallsOf } = makeReads(items);
  const extractor = createScheduleExtractor({ agentFactory: factory, reads });
  return { extractor, specs, prompts, itemCallsOf, rangeCallsOf };
}

const NOW = new Date("2026-11-15T08:00:00");

const ITEMS: readonly ScheduleItemRow[] = [
  { id: 1, title: "早饭", statuses: ["是", "否"], entryCount: 2 },
  { id: 2, title: "锻炼", statuses: ["完成", "部分", "没做"], entryCount: 0 },
];

describe("createScheduleExtractor", () => {
  it("captures the example sentence as three puts through the validation gate", async () => {
    const { extractor, specs, itemCallsOf } = makeExtractor(
      [
        { tool: "schedule_items", args: {} },
        {
          tool: "schedule_put",
          args: { itemId: 1, date: "2026-11-15", status: "否" },
        },
        {
          tool: "schedule_put",
          args: { itemId: 2, date: "2026-11-15", status: "否" },
        },
        {
          tool: "schedule_put",
          args: { itemId: 3, date: "2026-11-15", status: "是" },
        },
      ],
      [
        ...ITEMS,
        { id: 3, title: "晚饭", statuses: ["是", "否"], entryCount: 0 },
      ],
    );
    const draft: ScheduleDraft = await extractor.extract(
      "今天没有吃早饭,没有吃中饭,但是吃了晚饭",
      NOW,
    );
    expect(draft).toEqual({
      ops: [
        { kind: "put", itemId: 1, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 2, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 3, date: "2026-11-15", status: "是" },
      ],
    });
    expect(itemCallsOf()).toHaveLength(1);
    // Exactly four schedule tools, kinds as declared, and no item
    // management anywhere: creation, renaming, deletion and vocabulary
    // edits are UI-only, absent as tool definitions.
    expect(specs[0]!.tools.map((entry) => entry.tool.name)).toEqual([
      "schedule_items",
      "schedule_entries",
      "schedule_put",
      "schedule_clear",
    ]);
    const kinds = new Map(
      specs[0]!.tools.map((entry) => [entry.tool.name, entry.kind] as const),
    );
    expect(kinds.get("schedule_items")).toBe("read-only");
    expect(kinds.get("schedule_entries")).toBe("read-only");
    expect(kinds.get("schedule_put")).toBe("write-intent");
    expect(kinds.get("schedule_clear")).toBe("write-intent");
    expect(specs[0]!.policy.maxTurns).toBe(4);
  });

  it("bounces a fake calendar date back in-loop and accepts the corrected submit", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "schedule_put",
        // Shape-valid (the regex passes) but not a real date: normalizeEntryPut
        // throws, the loop continues, the model corrects.
        args: { itemId: 1, date: "2026-02-30", status: "是" },
      },
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: "是" },
      },
    ]);
    const draft: ScheduleDraft = await extractor.extract("今天吃了早饭", NOW);
    expect(draft).toEqual({
      ops: [{ kind: "put", itemId: 1, date: "2026-11-15", status: "是" }],
    });
  });

  it("the last submit for a natural key wins, puts and clears alike", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: "是" },
      },
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: "否" },
      },
      { tool: "schedule_clear", args: { itemId: 2, date: "2026-11-15" } },
      {
        tool: "schedule_put",
        args: { itemId: 2, date: "2026-11-15", status: "完成" },
      },
    ]);
    const draft: ScheduleDraft = await extractor.extract(
      "改一下今天的记录",
      NOW,
    );
    expect(draft).toEqual({
      ops: [
        { kind: "put", itemId: 1, date: "2026-11-15", status: "否" },
        { kind: "put", itemId: 2, date: "2026-11-15", status: "完成" },
      ],
    });
  });

  it("normalizes the status word before capture, like the HTTP path", async () => {
    const { extractor } = makeExtractor([
      // The date must arrive schema-clean; the status passes the schema
      // and gets trimmed by the same normalization the HTTP path uses.
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: " 是 " },
      },
    ]);
    const draft: ScheduleDraft = await extractor.extract("今天吃了早饭", NOW);
    expect(draft).toEqual({
      ops: [{ kind: "put", itemId: 1, date: "2026-11-15", status: "是" }],
    });
  });

  it("a final text with no submissions becomes the clarifying question", async () => {
    const { extractor } = makeExtractor([
      { tool: "schedule_items", args: {} },
      { text: "没有找到叫「午饭」的事项。请先在界面里创建事项,再说一次。" },
    ]);
    const draft: ScheduleDraft = await extractor.extract("午饭没吃", NOW);
    expect(draft).toEqual({
      question: "没有找到叫「午饭」的事项。请先在界面里创建事项,再说一次。",
    });
  });

  it("a blank ending without submissions answers unparseable-output", async () => {
    const { extractor } = makeExtractor([{ text: "" }]);
    const error = await caughtAiError(extractor.extract("随便说说", NOW));
    expect(error.code).toBe("unparseable-output");
  });

  it("reports max-turns-exceeded when the loop never settles", async () => {
    const { extractor } = makeExtractor([
      { tool: "schedule_put", args: { itemId: 1, date: "nope", status: "是" } },
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-13-40", status: "是" },
      },
      {
        tool: "schedule_put",
        args: { itemId: 0, date: "2026-11-15", status: "是" },
      },
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: "" },
      },
    ]);
    const error = await caughtAiError(extractor.extract("乱七八糟", NOW));
    expect(error.code).toBe("max-turns-exceeded");
  });

  it("the prompt pins the injected local date and keeps tool names out of the prose", async () => {
    const { extractor, specs, prompts } = makeExtractor([{ text: "" }]);
    // A blank ending with no submissions is the unsettled path; the spec
    // and prompt assertions are what this test is about.
    await expect(
      extractor.extract("hi", new Date("2026-03-05T23:00:00")),
    ).rejects.toBeInstanceOf(AiError);
    const prompt = buildSystemPrompt(specs[0]!);
    expect(prompt).toContain("2026-03-05");
    // A sentence without a date defaults to today, never a question.
    expect(prompt).toContain("未提及日期就是今天");
    expect(prompts).toEqual(["hi"]);
    const prose = [
      specs[0]!.preamble,
      ...(specs[0]!.rules ?? []),
      ...(specs[0]!.context ?? []),
    ].join("\n");
    for (const entry of specs[0]!.tools) {
      expect(prose).not.toContain(entry.tool.name);
    }
  });

  it("the read tools answer through the reads port", async () => {
    const { extractor, rangeCallsOf } = makeExtractor(
      [
        {
          tool: "schedule_entries",
          args: { from: "2026-11-09", to: "2026-11-15" },
        },
        { text: "" },
      ],
      ITEMS,
    );
    await expect(
      extractor.extract("这周锻炼记了几天", NOW),
    ).rejects.toBeInstanceOf(AiError);
    expect(rangeCallsOf()).toEqual(["2026-11-09..2026-11-15"]);
  });
});

/**
 * The memory wiring: the whole-book `<memory>` section rides the
 * extraction spec, the conversational memory tools ride the toolset,
 * and a memory write the run executed travels back on the ops draft
 * (a question carries none — it lands nothing).
 */
describe("createScheduleExtractor with the memory port", () => {
  const MEMORY_SECTION = "## 约定\n- 咖啡记「饮品」";

  /** A minimal memory service: remember lands, everything else unused. */
  function makeFakeMemoryService(): MemoryService {
    return {
      readFile: async () => "",
      remember: async (input): Promise<MemoryWriteResult> => ({
        kind: "receipt",
        receipt: {
          action: "remembered",
          section: input.section,
          after: `- ${input.text}`,
          created_at: "2026-11-15T08:00:00.000Z",
        },
      }),
      forget: async () => {
        throw new Error("unused");
      },
      resetMemory: async () => ({ reset_at: "2026-11-15T08:00:00.000Z" }),
      buildMemorySection: async () => MEMORY_SECTION,
      observeSession: () => {},
      isOffRecord: () => false,
      getOffRecord: () => ({ sessionId: null, on: false }),
      setOffRecord: () => {},
    };
  }

  /**
   * The fake loop for memory-aware runs: it replays the real transcript —
   * assistant toolCall, the tool's real execute, the toolResult — so the
   * receipt scan sees what it would see in production.
   */
  function makeMemoryAwareFactory(steps: readonly Step[]) {
    const specs: TobyAgentSpec[] = [];
    const factory: TobyAgentFactory = (spec) => {
      specs.push(spec);
      const toolsByName = new Map<string, TobyTool>(
        spec.tools.map((entry) => [entry.tool.name, entry] as const),
      );
      const agent: TobyAgent = {
        async run(prompt: string): Promise<TobyAgentRunResult> {
          const messages: unknown[] = [
            { role: "user", content: prompt, timestamp: 1 },
          ];
          let text = "";
          let callIndex = 0;
          for (const step of steps) {
            if ("text" in step) {
              text = step.text;
              break;
            }
            const entry = toolsByName.get(step.tool);
            if (!entry) {
              throw new Error(`fake loop: unregistered tool ${step.tool}`);
            }
            callIndex += 1;
            const id = `c${callIndex}`;
            messages.push({
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id,
                  name: entry.tool.name,
                  arguments: step.args,
                },
              ],
              model: "faux-1",
              api: "faux",
              provider: "faux",
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              stopReason: "toolUse",
              timestamp: 1 + callIndex,
            });
            const result = await entry.tool.execute(id, step.args as never);
            messages.push({
              role: "toolResult",
              toolCallId: id,
              toolName: entry.tool.name,
              content: result.content,
              details: result.details,
              isError: result.isError === true,
              timestamp: 1 + callIndex,
            });
          }
          return {
            text,
            turns: steps.length,
            turnCapped: false,
            stopReason: "stop" as const,
            messages: messages as never[],
            producedMessages: messages as never[],
          };
        },
      };
      return agent;
    };
    return { factory, specs };
  }

  function makeMemoryExtractor(steps: readonly Step[]) {
    const memoryTools = createMemoryTools({
      service: makeFakeMemoryService(),
    });
    let sectionCalls = 0;
    const memory: ScheduleMemoryPort = {
      sectionFor: async () => {
        sectionCalls += 1;
        return MEMORY_SECTION;
      },
      tools: [memoryTools.remember, memoryTools.forget],
    };
    const { reads } = makeReads(ITEMS);
    const { factory, specs } = makeMemoryAwareFactory(steps);
    const extractor = createScheduleExtractor({
      agentFactory: factory,
      reads,
      memory,
    });
    return { extractor, specs, sectionCallsOf: () => sectionCalls };
  }

  it("the extraction spec carries the memory tools and the whole-book section", async () => {
    const { extractor, specs, sectionCallsOf } = makeMemoryExtractor([
      { text: "" },
    ]);
    await expect(extractor.extract("早饭没吃", NOW)).rejects.toBeInstanceOf(
      AiError,
    );
    const spec = specs[0]!;
    // The conversational pair rides after the schedule's own tools —
    // there is no recall: the whole book is already in the prompt.
    expect(spec.tools.map((entry) => entry.tool.name)).toEqual([
      "schedule_items",
      "schedule_entries",
      "schedule_put",
      "schedule_clear",
      "remember",
      "forget",
    ]);
    expect(spec.memory).toBeTypeOf("function");
    expect(await (spec.memory as () => Promise<string>)()).toBe(MEMORY_SECTION);
    expect(sectionCallsOf()).toBe(1);
  });

  it("a corrupt memory file degrades the section to one honest line", async () => {
    const memoryTools = createMemoryTools({
      service: makeFakeMemoryService(),
    });
    const memory: ScheduleMemoryPort = {
      sectionFor: async () => {
        throw new Error("MEMORY.md 第 3 行无法解析");
      },
      tools: [memoryTools.remember, memoryTools.forget],
    };
    const { reads } = makeReads(ITEMS);
    const { factory, specs } = makeMemoryAwareFactory([{ text: "" }]);
    const extractor = createScheduleExtractor({
      agentFactory: factory,
      reads,
      memory,
    });
    await expect(extractor.extract("hi", NOW)).rejects.toBeInstanceOf(AiError);
    expect(await (specs[0]!.memory as () => Promise<string>)()).toBe(
      "（记忆文件当前无法读取）",
    );
  });

  it("a memory write the run executed rides back on the ops draft", async () => {
    const { extractor } = makeMemoryExtractor([
      {
        tool: "remember",
        args: { section: "约定", text: "咖啡记「饮品」" },
      },
      {
        tool: "schedule_put",
        args: { itemId: 1, date: "2026-11-15", status: "否" },
      },
    ]);
    const draft: ScheduleDraft = await extractor.extract(
      "早饭没吃,记住咖啡记饮品",
      NOW,
    );
    expect(draft).toEqual({
      ops: [{ kind: "put", itemId: 1, date: "2026-11-15", status: "否" }],
      memoryReceipts: [
        {
          action: "remembered",
          section: "约定",
          after: "- 咖啡记「饮品」",
          created_at: "2026-11-15T08:00:00.000Z",
        },
      ],
    });
  });

  it("a question carries no receipts — it has no channel", async () => {
    const { extractor } = makeMemoryExtractor([
      {
        tool: "remember",
        args: { section: "约定", text: "咖啡记「饮品」" },
      },
      { text: "没有找到这个事项,请先在界面里创建。" },
    ]);
    const draft: ScheduleDraft = await extractor.extract(
      "午饭没吃,记住咖啡记饮品",
      NOW,
    );
    expect(draft).toEqual({
      question: "没有找到这个事项,请先在界面里创建。",
    });
    expect(draft).not.toHaveProperty("memoryReceipts");
  });
});
