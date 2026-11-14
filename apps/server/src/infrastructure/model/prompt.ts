/**
 * The agent system prompt, assembled from named sections in one place:
 *
 *   preamble    hand-written identity (plain text, no tag)
 *   <tools>     generated from the registered tools: one line per tool,
 *               with that tool's own usage notes nested under it
 *   <rules>     the domain's own rules
 *   <memory>    the resolved memory section (optional, per run)
 *   <context>   the values that change every run (date, weekday, ...)
 *
 * Two rules keep this honest:
 * - Tool names appear only in the generated <tools> section. Hand-written
 *   text describes behaviour, never procedures, so a renamed tool cannot
 *   leave a stale name behind in prose (a violation fails assembly). The
 *   one exemption is the <memory> section's index heading, which names the
 *   recall tool by design (docs/decisions/personal-agent-memory.md).
 * - <context> is rendered last: it is the only section that changes per
 *   run, so the static prefix ahead of it stays byte-identical for
 *   provider prompt caching. <memory> resolves per run too; its provider
 *   lives on the agent spec (agent.ts) and the run hands the resolved
 *   text to buildSystemPrompt.
 *
 * Empty sections are omitted, and each list is deduplicated by its trimmed
 * text. Everything is plain text — the model-facing tool contract is still
 * the API's tool declarations, not this section (see docs/decisions/
 * ai-pi-runtime.md).
 */

import type { TobyTool } from "./agent.ts";

/** The parts a domain hands to the runtime; the runtime renders them. */
export interface TobyPromptSpec {
  /** The hand-written identity; several lines are allowed. */
  readonly preamble: string;
  /** The tools the model may call; each contributes its snippet and notes. */
  readonly tools: readonly TobyTool[];
  /** The domain's own rules (behaviour, tone, boundaries). */
  readonly rules?: readonly string[];
  /** Per-run values (today's date, weekday, timezone, later memories). */
  readonly context?: readonly string[];
}

/**
 * One prompt line: trimmed, non-empty, single-line. Used for every piece a
 * tool contributes (a multi-line snippet would break the generated list)
 * and exported so `defineTool` fails at definition time, not at assembly.
 */
export function promptLine(text: string, label: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new Error(`${label} must be a single line`);
  }
  return trimmed;
}

/** Trim, reject empty lines, and keep the first occurrence of each text. */
function uniqueLines(lines: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  const rendered: string[] = [];
  for (const line of lines) {
    const text = promptLine(line, label);
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    rendered.push(text);
  }
  return rendered;
}

/**
 * Refuse hand-written text that names a registered tool: the name already
 * lives in the tool definition and the generated <tools> section, and a
 * second mention would go stale on the next rename. Tool guidelines are
 * checked too — rendered under their tool, they can say "this tool".
 * The `<memory>` section is deliberately exempt: its index heading names
 * the recall tool by design
 * (docs/decisions/personal-agent-memory.md, "How it is read").
 */
function assertNoToolNames(spec: TobyPromptSpec, preamble: string): void {
  const prose = [
    preamble,
    ...(spec.rules ?? []),
    ...(spec.context ?? []),
    ...spec.tools.flatMap((entry) => entry.promptGuidelines),
  ].join("\n");
  for (const entry of spec.tools) {
    const name = entry.tool.name;
    if (prose.includes(name)) {
      throw new Error(
        `hand-written prompt text names tool "${name}"; tool names belong in the generated <tools> section`,
      );
    }
  }
}

export function buildSystemPrompt(
  spec: TobyPromptSpec,
  memory?: string,
): string {
  const preamble = spec.preamble.trim();
  if (preamble.length === 0) {
    throw new Error("preamble must not be empty");
  }
  assertNoToolNames(spec, preamble);

  const tools: string[] = [];
  for (const entry of spec.tools) {
    const name = entry.tool.name;
    tools.push(
      `- ${name}：${promptLine(entry.promptSnippet, `promptSnippet of ${name}`)}`,
    );
    for (const guideline of uniqueLines(
      entry.promptGuidelines,
      `promptGuidelines of ${name}`,
    )) {
      tools.push(`  - ${guideline}`);
    }
  }
  const rules = uniqueLines(spec.rules ?? [], "rule").map(
    (rule) => `- ${rule}`,
  );
  const context = uniqueLines(spec.context ?? [], "context line");

  const parts = [preamble];
  const section = (name: string, lines: readonly string[]): void => {
    if (lines.length > 0) {
      parts.push([`<${name}>`, ...lines, `</${name}>`].join("\n"));
    }
  };
  section("tools", tools);
  section("rules", rules);
  // The resolved `<memory>` section (docs/decisions/personal-agent-memory.md):
  // multi-line by nature (it quotes whole entry lines), omitted when empty,
  // and rendered after <rules> so <context> stays last — the per-run prefix
  // ahead of it remains byte-identical for provider prompt caching. Unlike
  // every other section it is exempt from the tool-name check above: the
  // index heading deliberately names the recall tool.
  const memoryText = memory?.trim() ?? "";
  if (memoryText.length > 0) {
    parts.push(["<memory>", memoryText, "</memory>"].join("\n"));
  }
  section("context", context);
  return parts.join("\n\n");
}
