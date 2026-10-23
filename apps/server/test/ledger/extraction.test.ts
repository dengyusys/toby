/**
 * Ledger extraction against a scripted fake agent factory: the submit and
 * ask-user paths, the in-loop correction when a draft violates validation
 * (the same gate as the structured path), the turn cap, and the prompt's
 * pinned local date. The fake factory replays the real loop's contract:
 * tool executes run in order, thrown errors become model-visible failures,
 * and the run ends after the scripted steps.
 */

import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import {
  createLedgerExtractor,
  type LedgerDraft,
} from "../../src/domains/ledger/extraction.ts";
import type {
  TobyAgent,
  TobyAgentFactory,
  TobyAgentRunResult,
  TobyAgentSpec,
  TobyTool,
} from "../../src/infrastructure/ai/agent.ts";
import { AiError } from "../../src/infrastructure/ai/errors.ts";
import { caught } from "../helpers.ts";

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
            };
          }
          const entry = toolsByName.get(step.tool);
          if (!entry) {
            throw new Error(`fake loop: unregistered tool ${step.tool}`);
          }
          // Mirrors the real runtime: schema-invalid arguments become a
          // model-visible error tool result and execute never runs.
          if (!Check(entry.tool.parameters, step.args)) {
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
          account: "未关联",
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
    expect(specs[0]!.systemPrompt).toContain("2026-03-05");
    expect(prompts).toEqual(["hi"]);
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
          account: "未关联",
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
    const error = await caught(extractor.extract("乱七八糟", NOW));
    expect(error.code).toBe("max-turns-exceeded");
  });

  it("reports unparseable-output when the model ends without either tool", async () => {
    const { extractor } = makeExtractor([{ text: "我猜是 35 元" }]);
    const error = await caught(extractor.extract("35", NOW));
    expect(error.code).toBe("unparseable-output");
  });
});
