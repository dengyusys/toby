/**
 * The prompt builder's contract: section order (preamble, tools, rules,
 * memory, context), the generated <tools> lines from tool metadata, omitted
 * empty sections, deduplicated lists, context last (the only section that
 * changes per run), and the rule that hand-written prose never names a tool
 * — with the <memory> section the one deliberate exemption.
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

  it("renders the <memory> section between rules and context, multi-line intact", () => {
    const memory = [
      "## 约定",
      "- 咖啡记「饮品」",
      "",
      "## 记忆索引 — 详情用 recall 工具查询",
      "人物: 小王",
    ].join("\n");
    const prompt = buildSystemPrompt(
      {
        preamble: "sys",
        tools: [tool("alpha", "does alpha")],
        rules: ["be brief"],
        context: ["today is 2026-11-06"],
      },
      memory,
    );

    expect(prompt).toBe(
      [
        "sys",
        "",
        "<tools>",
        "- alpha：does alpha",
        "</tools>",
        "",
        "<rules>",
        "- be brief",
        "</rules>",
        "",
        "<memory>",
        "## 约定",
        "- 咖啡记「饮品」",
        "",
        "## 记忆索引 — 详情用 recall 工具查询",
        "人物: 小王",
        "</memory>",
        "",
        "<context>",
        "today is 2026-11-06",
        "</context>",
      ].join("\n"),
    );
  });

  it("omits the <memory> section when absent or blank", () => {
    const spec = { preamble: "sys", tools: [tool("alpha", "does alpha")] };
    expect(buildSystemPrompt(spec)).not.toContain("<memory>");
    expect(buildSystemPrompt(spec, "   \n  ")).not.toContain("<memory>");
    // Surrounding whitespace around real content is trimmed, not dropped.
    expect(buildSystemPrompt(spec, "  咖啡记「饮品」  ")).toBe(
      [
        "sys",
        "",
        "<tools>",
        "- alpha：does alpha",
        "</tools>",
        "",
        "<memory>",
        "咖啡记「饮品」",
        "</memory>",
      ].join("\n"),
    );
  });

  it("exempts the <memory> section from the tool-name check by design", () => {
    // The index heading names recall on purpose
    // (docs/decisions/personal-agent-memory.md): assembly must not throw.
    expect(() =>
      buildSystemPrompt(
        {
          preamble: "sys",
          tools: [tool("recall", "翻查记忆条目")],
          rules: ["先查再答"],
        },
        "## 记忆索引 — 详情用 recall 工具查询",
      ),
    ).not.toThrow();
    // The same mention in hand-written prose stays a violation.
    expect(() =>
      buildSystemPrompt({
        preamble: "sys",
        tools: [tool("recall", "翻查记忆条目")],
        rules: ["详情用 recall 工具查询"],
      }),
    ).toThrow(/names tool "recall"/);
  });
});
