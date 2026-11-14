/**
 * Ledger extraction against a scripted fake agent factory: the submit and
 * ask-user paths, the in-loop correction when a draft violates validation
 * (the same gate as the structured path), the turn cap, and the prompt's
 * pinned local date. The fake factory replays the real loop's contract:
 * tool executes run in order, thrown errors become model-visible failures,
 * and the run ends after the scripted steps.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message } from "@earendil-works/pi-ai";
import {
  createLedgerExtractor,
  type LedgerDraft,
  type LedgerMemoryPort,
} from "../../src/domains/ledger/extraction.ts";
import {
  LEDGER_EDIT_TOOL_SCHEMA,
  LEDGER_ENTRIES_TOOL_SCHEMA,
} from "../../src/domains/ledger/schema.ts";
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
  submit_entries: LEDGER_ENTRIES_TOOL_SCHEMA,
  submit_edit: LEDGER_EDIT_TOOL_SCHEMA,
  ask_user: z.object({ question: z.string().min(1) }).strict(),
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
              // Extraction ignores the transcript; the fields exist to
              // satisfy the result contract.
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

function makeExtractor(steps: readonly Step[]) {
  const { factory, specs, prompts } = makeFakeFactory(steps);
  const extractor = createLedgerExtractor({ agentFactory: factory });
  return { extractor, specs, prompts };
}

const NOW = new Date("2026-10-20T08:00:00");

describe("createLedgerExtractor", () => {
  it("captures a submitted draft through the validation gate", async () => {
    const { extractor, specs } = makeExtractor([
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-10-19",
              type: "expense",
              category: "餐饮",
              amount: "35",
              note: "昨晚外卖",
            },
          ],
        },
      },
    ]);
    const draft = await extractor.extract("昨晚外卖35", NOW);
    expect(draft).toEqual({
      entries: [
        {
          date: "2026-10-19",
          type: "expense",
          category: "餐饮",
          amount: 3500,
          note: "昨晚外卖",
        },
      ],
    });
    // The spec carries both tools; submit is classified write-intent.
    const kinds = new Map(
      specs[0]!.tools.map((entry) => [entry.tool.name, entry.kind] as const),
    );
    expect(kinds.get("submit_entries")).toBe("write-intent");
    expect(kinds.get("submit_edit")).toBe("write-intent");
    expect(kinds.get("ask_user")).toBe("read-only");
    expect(specs[0]!.policy.maxTurns).toBe(3);
  });

  it("the prompt pins the injected local date and carries the sentence", async () => {
    const { extractor, specs, prompts } = makeExtractor([{ text: "unused" }]);
    // A text-only ending is an unsettled extraction; the spec and prompt
    // assertions are what this test is about.
    await expect(
      extractor.extract("hi", new Date("2026-03-05T23:00:00")),
    ).rejects.toBeInstanceOf(AiError);
    const prompt = buildSystemPrompt(specs[0]!);
    expect(prompt).toContain("2026-03-05");
    // A sentence without a date must default to today, not trigger a
    // follow-up question about the date.
    expect(prompt).toContain("未提及日期就是今天");
    expect(prompts).toEqual(["hi"]);
  });

  it("keeps tool names out of the hand-written prompt text", async () => {
    const { extractor, specs } = makeExtractor([{ text: "unused" }]);
    await expect(extractor.extract("hi", NOW)).rejects.toBeInstanceOf(AiError);
    const spec = specs[0]!;
    // The runtime renders <tools> from the definitions; every other section
    // stays free of names, so a renamed tool cannot leave a stale mention.
    const prose = [
      spec.preamble,
      ...(spec.rules ?? []),
      ...(spec.context ?? []),
    ].join("\n");
    for (const entry of spec.tools) {
      expect(prose).not.toContain(entry.tool.name);
    }
    const prompt = buildSystemPrompt(spec);
    expect(prompt).toContain("- submit_entries：");
    expect(prompt).toContain("- ask_user：");
    // The behaviour the prompt used to spell out survives as rules/notes.
    expect(prompt).toContain("能确定就直接提交");
    expect(prompt).toContain("才用本工具");
  });

  it("captures a clarifying question via ask_user", async () => {
    const { extractor } = makeExtractor([
      { tool: "ask_user", args: { question: "这笔是支出还是收入?" } },
    ]);
    const draft: LedgerDraft = await extractor.extract("book 25", NOW);
    expect(draft).toEqual({ question: "这笔是支出还是收入?" });
  });

  it("bounces a blank question back instead of returning it", async () => {
    const { extractor } = makeExtractor([
      // Schema-valid (minLength on the raw string) but blank after trim:
      // the execute throws and the model re-asks.
      { tool: "ask_user", args: { question: "   " } },
      { tool: "ask_user", args: { question: "这笔是支出还是收入?" } },
    ]);
    const draft: LedgerDraft = await extractor.extract("book 25", NOW);
    expect(draft).toEqual({ question: "这笔是支出还是收入?" });
  });

  it("feeds validation failures back in-loop and accepts the corrected batch", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "submit_entries",
        // Shape-valid but semantically invalid: 2026-02-30 passes the schema
        // and dies in normalizeEntries (real calendar). The execute throws
        // (LedgerInputError), the loop continues, the model corrects.
        args: {
          entries: [
            {
              date: "2026-02-30",
              type: "expense",
              category: "餐饮",
              amount: "35",
            },
          ],
        },
      },
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-10-20",
              type: "expense",
              category: "餐饮",
              amount: "35",
            },
          ],
        },
      },
    ]);
    const draft = await extractor.extract("2月30号午饭 35", NOW);
    expect(draft).toEqual({
      entries: [
        {
          date: "2026-10-20",
          type: "expense",
          category: "餐饮",
          amount: 3500,
          note: "",
        },
      ],
    });
  });

  it("reports max-turns-exceeded when the loop never settles", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-13-40",
              type: "expense",
              category: "餐饮",
              amount: "35",
            },
          ],
        },
      },
      {
        tool: "submit_entries",
        args: {
          entries: [
            { date: "nope", type: "expense", category: "餐饮", amount: "35" },
          ],
        },
      },
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-10-20",
              type: "nonsense",
              category: "餐饮",
              amount: "35",
            },
          ],
        },
      },
    ]);
    const error = await caughtAiError(extractor.extract("乱七八糟", NOW));
    expect(error.code).toBe("max-turns-exceeded");
  });

  it("captures a submitted edit through the same validation gate", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "submit_edit",
        args: {
          match: { date: "2026-10-19", category: " 餐饮 " },
          patch: { amount: "35" },
        },
      },
    ]);
    const draft = await extractor.extract("昨天午饭那笔改成35", NOW);
    expect(draft).toEqual({
      edit: {
        match: { date: "2026-10-19", category: "餐饮" },
        patch: { amount: 3500 },
      },
    });
  });

  it("bounces a criterion-less edit back and accepts the corrected one", async () => {
    const { extractor } = makeExtractor([
      {
        tool: "submit_edit",
        // Shape-valid but empty match: nothing to narrow a day's rows
        // with, so execute throws and the loop continues to the correction.
        args: { match: {}, patch: { amount: "35" } },
      },
      {
        tool: "submit_edit",
        args: {
          match: { date: "2026-10-20", note_contains: "午饭" },
          patch: { amount: "35" },
        },
      },
    ]);
    const draft = await extractor.extract("那笔改成35", NOW);
    expect(draft).toEqual({
      edit: {
        match: { date: "2026-10-20", note_contains: "午饭" },
        patch: { amount: 3500 },
      },
    });
  });

  it("reports unparseable-output when the model ends without either tool", async () => {
    const { extractor } = makeExtractor([{ text: "我猜是 35 元" }]);
    const error = await caughtAiError(extractor.extract("35", NOW));
    expect(error.code).toBe("unparseable-output");
  });
});

/**
 * The memory wiring: the sentence-scoped `<memory>` section rides the
 * extraction spec, the conversational memory tools ride the toolset, and
 * a memory write the run executed travels back on the draft as
 * memory_receipts (a follow-up question carries none — it lands nothing).
 */
describe("createLedgerExtractor with the memory port", () => {
  const MEMORY_SECTION = "## 约定\n- 咖啡记「饮品」";

  /** A minimal memory service: remember lands, everything else unused. */
  function makeFakeMemoryService(): MemoryService {
    return {
      list: async () => ({ entries: [] }),
      exportMarkdown: async () => "",
      recall: async () => [],
      remember: async (input): Promise<MemoryWriteResult> => ({
        kind: "receipt",
        receipt: {
          action: "remembered",
          type: input.type,
          after: `- ${input.text}`,
          created_at: "2026-10-20T08:00:00.000Z",
        },
      }),
      forget: async () => {
        throw new Error("unused");
      },
      replaceExact: async () => {
        throw new Error("unused");
      },
      buildMemorySection: async () => MEMORY_SECTION,
      observeSession: () => {},
      isOffRecord: () => false,
      getOffRecord: () => ({ sessionId: null, on: false }),
      setOffRecord: () => {},
    };
  }

  /**
   * The fake loop for memory-aware runs: unlike the plain factory above,
   * it replays the real transcript — assistant toolCall, the tool's real
   * execute, the toolResult — so the receipt scan sees what it would see
   * in production.
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
            messages: messages as Message[],
            producedMessages: messages as Message[],
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
    const sectionsFor: string[] = [];
    const memory: LedgerMemoryPort = {
      sectionFor: async (sentence) => {
        sectionsFor.push(sentence);
        return MEMORY_SECTION;
      },
      tools: [memoryTools.recall, memoryTools.remember, memoryTools.forget],
    };
    const { factory, specs } = makeMemoryAwareFactory(steps);
    const extractor = createLedgerExtractor({ agentFactory: factory, memory });
    return { extractor, specs, sectionsFor };
  }

  it("the extraction spec carries the memory tools and the sentence-scoped section", async () => {
    const { extractor, specs, sectionsFor } = makeMemoryExtractor([
      { text: "unused" },
    ]);
    await expect(extractor.extract("午饭 30", NOW)).rejects.toBeInstanceOf(
      AiError,
    );
    const spec = specs[0]!;
    // The conversational trio rides after the ledger's own tools.
    expect(spec.tools.map((entry) => entry.tool.name)).toEqual([
      "submit_entries",
      "submit_edit",
      "ask_user",
      "recall",
      "remember",
      "forget",
    ]);
    expect(spec.memory).toBeTypeOf("function");
    expect(await (spec.memory as () => Promise<string>)()).toBe(MEMORY_SECTION);
    expect(sectionsFor).toEqual(["午饭 30"]);
    // The section is exempt from the tool-name check: an index heading
    // may name recall; assembly must not throw.
    const prompt = buildSystemPrompt(spec, MEMORY_SECTION);
    expect(prompt).toContain("<memory>\n## 约定\n- 咖啡记「饮品」\n</memory>");
    const rulesEnd = prompt.indexOf("</rules>");
    const memoryStart = prompt.indexOf("<memory>");
    const contextStart = prompt.indexOf("<context>");
    expect(rulesEnd).toBeLessThan(memoryStart);
    expect(memoryStart).toBeLessThan(contextStart);
  });

  it("a corrupt memory file degrades the section to one honest line", async () => {
    const memoryTools = createMemoryTools({
      service: makeFakeMemoryService(),
    });
    const memory: LedgerMemoryPort = {
      sectionFor: async () => {
        throw new Error("MEMORY.md 第 3 行无法解析");
      },
      tools: [memoryTools.recall, memoryTools.remember, memoryTools.forget],
    };
    const { factory, specs } = makeMemoryAwareFactory([{ text: "unused" }]);
    const extractor = createLedgerExtractor({ agentFactory: factory, memory });
    await expect(extractor.extract("hi", NOW)).rejects.toBeInstanceOf(AiError);
    expect(await (specs[0]!.memory as () => Promise<string>)()).toBe(
      "（记忆文件当前无法读取）",
    );
  });

  it("a memory write the run executed rides back on the entries draft", async () => {
    const { extractor } = makeMemoryExtractor([
      { tool: "remember", args: { type: "约定", text: "咖啡记「饮品」" } },
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-10-20",
              type: "expense",
              category: "餐饮",
              amount: "30",
            },
          ],
        },
      },
    ]);
    const draft = await extractor.extract("午饭30,记住咖啡记饮品", NOW);
    expect(draft).toEqual({
      entries: [
        {
          date: "2026-10-20",
          type: "expense",
          category: "餐饮",
          amount: 3000,
          note: "",
        },
      ],
      memory_receipts: [
        {
          action: "remembered",
          type: "约定",
          after: "- 咖啡记「饮品」",
          created_at: "2026-10-20T08:00:00.000Z",
        },
      ],
    });
  });

  it("a follow-up question carries no receipts — it has no channel", async () => {
    const { extractor } = makeMemoryExtractor([
      { tool: "remember", args: { type: "约定", text: "咖啡记「饮品」" } },
      { tool: "ask_user", args: { question: "这笔是支出还是收入?" } },
    ]);
    const draft = await extractor.extract("book 25,记住咖啡记饮品", NOW);
    // The memory write itself still landed (its card rides the tool
    // result); the question draft stays bare.
    expect(draft).toEqual({ question: "这笔是支出还是收入?" });
    expect(draft).not.toHaveProperty("memory_receipts");
  });

  it("a run that wrote no memory returns the old draft shape, receipts absent", async () => {
    const { extractor } = makeMemoryExtractor([
      {
        tool: "submit_entries",
        args: {
          entries: [
            {
              date: "2026-10-20",
              type: "expense",
              category: "餐饮",
              amount: "30",
            },
          ],
        },
      },
    ]);
    const draft = await extractor.extract("午饭30", NOW);
    expect(draft).toEqual({
      entries: [
        {
          date: "2026-10-20",
          type: "expense",
          category: "餐饮",
          amount: 3000,
          note: "",
        },
      ],
    });
    expect(draft).not.toHaveProperty("memory_receipts");
  });
});
