/**
 * The deterministic Markdown parser and serializer — part of validation,
 * not presentation (docs/decisions/personal-agent-memory.md). Every line
 * of MEMORY.md either parses or rejects the file; serialize ∘ parse is
 * stable, so hand edits and domain writes share one file forever.
 *
 * Format: open topic sections — any `## <name>` heading (the name is
 * non-empty, trimmed, at most 24 characters, and unique in the file; a
 * duplicate heading is invalid — merge instead), followed by entry lines
 * `- text`, each with one optional trailing expiry marker
 * ` (至 YYYY-MM-DD)` and nothing else. Blank lines are allowed anywhere;
 * an empty file is the empty book. Dates are checked against the real
 * calendar by hand — no Date parsing.
 */

import { MemoryFileInvalidError } from "./errors.ts";
import type { MemoryEntry, ParsedMemory } from "./types.ts";

/** Section names are short: the bound on a heading (and on entry.section). */
export const MEMORY_SECTION_MAX_CHARS = 24;

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

/** Character count over code points, so any script counts fairly. */
function charLength(text: string): number {
  return [...text].length;
}

/**
 * The one rulebook for a section name, shared by the parser (a bad
 * heading rejects the file), the service (a bad name rejects the write
 * with INVALID_ENTRY) and the page's rename. Returns a human-readable
 * problem, or null when the name is valid.
 */
export function memorySectionNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "section must not be empty";
  }
  if (charLength(trimmed) > MEMORY_SECTION_MAX_CHARS) {
    return `section must be at most ${MEMORY_SECTION_MAX_CHARS} characters`;
  }
  return null;
}

/**
 * The rendered file line of one entry — also the exact-match key the
 * service uses for duplicate detection: `- text (至 date)`.
 */
export function renderMemoryLine(entry: MemoryEntry): string {
  return `- ${entry.text}${entry.until === undefined ? "" : ` (至 ${entry.until})`}`;
}

/**
 * The one validation rulebook for a single entry, shared by the service
 * (a problem rejects the write with INVALID_ENTRY) and the parser's own
 * line rules. Returns a human-readable problem, or null when the entry
 * is valid.
 */
export function memoryEntryProblem(entry: {
  section: string;
  text: string;
  until?: string;
}): string | null {
  const sectionProblem = memorySectionNameProblem(entry.section);
  if (sectionProblem !== null) {
    return sectionProblem;
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

/** One entry from the text after `- `. */
function entryFromLine(
  body: string,
  section: string,
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
  return { section, text, ...(until === undefined ? {} : { until }) };
}

/**
 * Parse the whole file. The first offending line throws
 * MemoryFileInvalidError with its line number in the message; nothing is
 * ever skipped, repaired or defaulted. An empty (or blank-only) file is
 * the empty book — every section starts from a first write.
 */
export function parseMemoryMarkdown(content: string): ParsedMemory {
  const lines = content.split(/\r\n|\r|\n/);
  const entries: MemoryEntry[] = [];
  const seenSections = new Set<string>();
  // null = before the first heading.
  let section: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNumber = i + 1;
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("##")) {
      if (line.startsWith("###")) {
        throw invalid(lineNumber, "只支持二级标题「## 」");
      }
      const name = line.slice(2).trim();
      const nameProblem = memorySectionNameProblem(name);
      if (nameProblem !== null) {
        throw invalid(lineNumber, `小节名无效: ${nameProblem}`);
      }
      if (seenSections.has(name)) {
        throw invalid(lineNumber, `重复的小节「${name}」——请合并同名小节`);
      }
      seenSections.add(name);
      section = name;
      continue;
    }
    if (section === null) {
      throw invalid(lineNumber, "必须以「## 小节名」开头");
    }
    if (!line.startsWith("- ")) {
      throw invalid(lineNumber, `无法解析的行: ${raw.trim()}`);
    }
    entries.push(entryFromLine(line.slice(2), section, lineNumber));
  }

  return { entries };
}

/**
 * The canonical file text: sections in file order (first appearance),
 * one blank line after each heading, a blank line between sections,
 * entries in file order within their section, and a trailing newline.
 * The empty book serializes to the empty string — sections exist only
 * where entries exist.
 */
export function serializeMemoryMarkdown(memory: ParsedMemory): string {
  // Group by section, first appearance first: a parsed file already has
  // unique headings, and grouping also makes any hand-built entry list
  // serialize to a file that parses (never duplicate headings).
  const order: string[] = [];
  const blocks = new Map<string, string[]>();
  for (const entry of memory.entries) {
    let lines = blocks.get(entry.section);
    if (lines === undefined) {
      lines = [`## ${entry.section}`, ""];
      blocks.set(entry.section, lines);
      order.push(entry.section);
    }
    lines.push(renderMemoryLine(entry));
  }
  const rendered: string[] = [];
  for (const section of order) {
    rendered.push((blocks.get(section) ?? []).join("\n"));
  }
  return rendered.length === 0 ? "" : `${rendered.join("\n\n")}\n`;
}
