/**
 * The deterministic Markdown parser and serializer — part of validation,
 * not presentation (docs/decisions/personal-agent-memory.md). Every line
 * of MEMORY.md either parses or rejects the file; serialize ∘ parse is
 * stable, so hand edits and domain writes share one file forever.
 *
 * Format: exactly three `##` headings in fixed order (`## 约定`,
 * `## 关于我`, `## 人物`); blank lines allowed anywhere; every other
 * non-empty line must be an entry line `- text`, or `- name: text` under
 * 人物, with one optional trailing expiry marker ` (至 YYYY-MM-DD)`.
 * Dates are checked against the real calendar by hand — no Date parsing.
 */

import { MemoryFileInvalidError } from "./errors.ts";
import type { MemoryEntry, MemoryType, ParsedMemory } from "./types.ts";

/** The fixed section order: also the file layout and the list order. */
export const MEMORY_SECTION_ORDER: readonly MemoryType[] = [
  "约定",
  "关于我",
  "人物",
];

/** The expiry marker at end of line: one space, then ` (至 YYYY-MM-DD)`. */
const UNTIL_MARKER_RE = /\s+\(至 (\d{4}-\d{2}-\d{2})\)\s*$/;
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Real-calendar check for a "YYYY-MM-DD" string (month range, month
 * length, leap years) — hand-written like the ledger's date validation.
 */
export function isValidMemoryDate(text: string): boolean {
  if (!DATE_SHAPE_RE.test(text)) {
    return false;
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (monthLengths[month - 1] ?? 0)
  );
}

/**
 * The rendered file line of one entry — also the exact-match key the
 * service uses for duplicates and replaceExact: `- text (至 date)` or
 * `- name: text (至 date)`.
 */
export function renderMemoryLine(entry: MemoryEntry): string {
  const body =
    entry.type === "人物" ? `${entry.name ?? ""}: ${entry.text}` : entry.text;
  return `- ${body}${entry.until === undefined ? "" : ` (至 ${entry.until})`}`;
}

/**
 * The one validation rulebook for a single entry, shared by the parser
 * (a problem rejects the file) and the service (a problem rejects the
 * write with INVALID_ENTRY). Returns a human-readable problem, or null
 * when the entry is valid.
 */
export function memoryEntryProblem(entry: {
  type: MemoryType;
  text: string;
  name?: string;
  until?: string;
}): string | null {
  if (!MEMORY_SECTION_ORDER.includes(entry.type)) {
    return "type must be one of 约定 / 关于我 / 人物";
  }
  const text = entry.text.trim();
  if (text.length === 0) {
    return "text must not be empty";
  }
  if (/[\r\n]/.test(text)) {
    return "text must be a single line";
  }
  // The marker must come from `until`, never from the text: a text that
  // ends like a marker would re-parse as an expiry and change meaning.
  if (
    entry.until === undefined &&
    /\s+\(至 \d{4}-\d{2}-\d{2}\)\s*$/.test(text)
  ) {
    return "text must not end with a (至 date) marker — pass until instead";
  }
  if (entry.type === "人物") {
    const name = (entry.name ?? "").trim();
    if (name.length === 0) {
      return "a 人物 entry needs a non-empty name";
    }
    if (name.includes(":")) {
      return 'name must not contain ":"';
    }
    if (/[\r\n]/.test(name)) {
      return "name must be a single line";
    }
  }
  if (entry.until !== undefined && !isValidMemoryDate(entry.until.trim())) {
    return `until is not a real calendar date: ${entry.until}`;
  }
  return null;
}

function invalid(lineNumber: number, detail: string): MemoryFileInvalidError {
  return new MemoryFileInvalidError(
    `MEMORY.md 第 ${lineNumber} 行无法解析（请手工修正 MEMORY.md）: ${detail}`,
  );
}

/** One entry from the text after `- `, per its section's rules. */
function entryFromLine(
  body: string,
  type: MemoryType,
  lineNumber: number,
): MemoryEntry {
  const markerMatch = UNTIL_MARKER_RE.exec(body);
  let until: string | undefined;
  let bodyPart = body;
  if (markerMatch !== null) {
    const candidate = markerMatch[1] ?? "";
    if (!isValidMemoryDate(candidate)) {
      throw invalid(lineNumber, `不是真实日期: (至 ${candidate})`);
    }
    until = candidate;
    bodyPart = body.slice(0, markerMatch.index);
  }
  const text = bodyPart.trim();
  if (text.length === 0) {
    throw invalid(lineNumber, "条目内容不能为空");
  }
  if (type === "人物") {
    const colonIndex = text.indexOf(":");
    if (colonIndex < 0) {
      throw invalid(lineNumber, "人物条目需要 name: text 形式");
    }
    const name = text.slice(0, colonIndex).trim();
    const entryText = text.slice(colonIndex + 1).trim();
    if (name.length === 0 || entryText.length === 0) {
      throw invalid(lineNumber, "人物条目的 name 和 text 都不能为空");
    }
    return {
      type,
      name,
      text: entryText,
      ...(until === undefined ? {} : { until }),
    };
  }
  return { type, text, ...(until === undefined ? {} : { until }) };
}

/**
 * Parse the whole file. The first offending line throws
 * MemoryFileInvalidError with its line number in the message; nothing is
 * ever skipped, repaired or defaulted.
 */
export function parseMemoryMarkdown(content: string): ParsedMemory {
  const lines = content.split(/\r\n|\r|\n/);
  const entries: MemoryEntry[] = [];
  // -1 = before the first heading; then indexes into MEMORY_SECTION_ORDER.
  let sectionIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNumber = i + 1;
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      const expected = MEMORY_SECTION_ORDER[sectionIndex + 1];
      if (expected === undefined) {
        throw invalid(lineNumber, `多余的标题「${line}」——只允许三个小节`);
      }
      if (heading !== expected) {
        throw invalid(lineNumber, `期望标题「## ${expected}」`);
      }
      sectionIndex += 1;
      continue;
    }
    if (sectionIndex < 0) {
      throw invalid(lineNumber, "必须以「## 约定」开头");
    }
    if (!line.startsWith("- ")) {
      throw invalid(lineNumber, `无法解析的行: ${raw.trim()}`);
    }
    entries.push(
      entryFromLine(
        line.slice(2),
        MEMORY_SECTION_ORDER[sectionIndex] as MemoryType,
        lineNumber,
      ),
    );
  }

  if (sectionIndex < 0) {
    throw invalid(lines.length, "缺少「## 约定」小节");
  }
  const missing = MEMORY_SECTION_ORDER[sectionIndex + 1];
  if (missing !== undefined) {
    throw invalid(lines.length, `缺少「## ${missing}」小节`);
  }
  return { entries };
}

/**
 * The canonical file text: headings in fixed order, one blank line after
 * each heading, a blank line between sections, entries in file order
 * within their type, and a trailing newline. Empty section = heading +
 * blank line.
 */
export function serializeMemoryMarkdown(memory: ParsedMemory): string {
  const lines: string[] = [];
  for (const type of MEMORY_SECTION_ORDER) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`## ${type}`);
    lines.push("");
    for (const entry of memory.entries) {
      if (entry.type === type) {
        lines.push(renderMemoryLine(entry));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
