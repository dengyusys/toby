/**
 * The prompt builder's contract: section order (preamble, tools, rules,
 * context), the generated <tools> lines from tool metadata, omitted empty
 * sections, deduplicated lists, context last (the only section that changes
 * per run), and the rule that hand-written prose never names a tool.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/infrastructure/model/agent.ts";
import { buildSystemPrompt } from "../../../src/infrastructure/model/prompt.ts";

function tool(
  name: string,
  snippet: string,
  guidelines: readonly string[] = [],
) {
  return defineTool("read-only", {
    name,
    label: name,
    description: `${name} tool`,
    promptSnippet: snippet,
    promptGuidelines: guidelines,
    parameters: z.object({}).strict(),
    execute: async () => ({ content: [], details: {} }),
  });
}

describe("buildSystemPrompt", () => {
  it("renders the sections in order, tools generated from metadata", () => {
    const prompt = buildSystemPrompt({
      preamble: "sys",
      tools: [
        tool("alpha", "does alpha", ["goes first"]),
        tool("beta", "does beta"),
      ],
      rules: ["be brief"],
      context: ["today is 2026-11-06"],
    });

    expect(prompt).toBe(
      [
        "sys",
        "",
        "<tools>",
        "- alpha：does alpha",
        "  - goes first",
        "- beta：does beta",
        "</tools>",
        "",
        "<rules>",
        "- be brief",
        "</rules>",
        "",
        "<context>",
        "today is 2026-11-06",
        "</context>",
      ].join("\n"),
    );
  });

  it("omits empty sections", () => {
    expect(buildSystemPrompt({ preamble: "sys", tools: [] })).toBe("sys");
  });

  it("rejects a blank rule instead of rendering an empty bullet", () => {
    expect(() =>
      buildSystemPrompt({ preamble: "sys", tools: [], rules: ["  "] }),
    ).toThrow(/rule must not be empty/);
  });

  it("deduplicates rules and guidelines, keeping the first occurrence", () => {
    const prompt = buildSystemPrompt({
      preamble: "sys",
      tools: [tool("alpha", "does alpha", ["step", " step "])],
      rules: ["be brief", " be brief "],
    });

    expect(prompt).toContain(
      "<tools>\n- alpha：does alpha\n  - step\n</tools>",
    );
    expect(prompt).toContain("<rules>\n- be brief\n</rules>");
    expect(prompt.match(/- step/g)).toHaveLength(1);
  });

  it("rejects hand-written text that names a tool", () => {
    expect(() =>
      buildSystemPrompt({
        preamble: "sys",
        tools: [tool("alpha", "does alpha")],
        rules: ["use alpha for everything"],
      }),
    ).toThrow(/names tool "alpha"/);
    expect(() =>
      buildSystemPrompt({
        preamble: "sys",
        tools: [tool("alpha", "does alpha", ["call alpha first"])],
      }),
    ).toThrow(/names tool "alpha"/);
  });

  it("rejects blank and multi-line tool prompt metadata", () => {
    expect(() => tool("alpha", " ")).toThrow(/must not be empty/);
    expect(() => tool("alpha", "two\nlines")).toThrow(/single line/);
    expect(() => tool("alpha", "ok", ["two\nlines"])).toThrow(/single line/);
  });
});
