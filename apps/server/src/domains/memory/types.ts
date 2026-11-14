/**
 * Memory domain types: the pure vocabulary shared by the parser, the
 * repository, the service and the routes. Plain data only — this file
 * stays import-free (the boundary tests enforce it). Response shapes are
 * mirrored by hand in packages/contract/src/memory-client.ts — change
 * both sides together.
 */

/**
 * One remembered line: one sentence under an open topic section, with an
 * optional expiry. This is the whole entry — no id, no source, no
 * timestamps, no name field (people entries keep the `名字:描述` shape as
 * house style, part of the text itself)
 * (docs/decisions/personal-agent-memory.md).
 */
export interface MemoryEntry {
  /** The topic section this line lives under (the `## ` heading). */
  readonly section: string;
  /** The line body, one sentence. */
  readonly text: string;
  /** Optional expiry, "YYYY-MM-DD"; an expired entry appears nowhere. */
  readonly until?: string;
}

/** The parsed file: every line validated, entries in file order. */
export interface ParsedMemory {
  readonly entries: readonly MemoryEntry[];
}

/**
 * The receipt of one landed change — the accountability card. before/after
 * are the rendered file lines (`- text (至 date)` for entries, `## name`
 * for a section rename), so the card quotes the file itself.
 */
export interface MemoryReceipt {
  readonly action: "remembered" | "updated" | "forgot";
  readonly section: string;
  readonly before?: string;
  readonly after?: string;
  /** UTC ISO instant of the write, from the domain clock. */
  readonly created_at: string;
}

/**
 * The closed result union of every memory write. Receipt-carrying outcomes
 * have landed; the other kinds are refusals the caller (the AI tools)
 * renders: several keyword hits (ask, never guess), an exact duplicate on
 * a plain append, or a forget that matched nothing.
 */
export type MemoryWriteResult =
  | { readonly kind: "receipt"; readonly receipt: MemoryReceipt }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] }
  | { readonly kind: "already-remembered"; readonly line: string }
  | { readonly kind: "nothing-matched" };

/** The off-record gate state: one session-scoped flag, in-process only. */
export interface MemoryOffRecordState {
  /** The session the flag is bound to; null until a session is observed. */
  readonly sessionId: string | null;
  readonly on: boolean;
}

/**
 * The memory service: reads (raw file, prompt section), writes (remember /
 * forget — the AI tools' path) and the human maintenance reset over the
 * repository, plus the in-process off-record gate. Declared here so later
 * lanes (chat tools, prompt builders) can compile against the port
 * without importing the module graph. There is no recall: the whole book
 * rides in every prompt, so there is nothing to fetch.
 */
export interface MemoryService {
  /** The raw MEMORY.md content; the empty book's text when missing. */
  readFile(): Promise<string>;
  /**
   * Append one entry, or replace the one non-expired hit of
   * replaceKeyword (substring over every non-expired entry text).
   * Returns a receipt, an ambiguity, or an already-remembered answer;
   * bad input throws MemoryInputError.
   */
  remember(input: {
    readonly section: string;
    readonly text: string;
    readonly until?: string;
    readonly replaceKeyword?: string;
  }): Promise<MemoryWriteResult>;
  /** Delete the one non-expired keyword hit; zero hits answer nothing-matched. */
  forget(keyword: string): Promise<MemoryWriteResult>;
  /**
   * The human maintenance reset: one atomic full-file replace with the
   * empty book. Never gated by off-record (it never touches the AI
   * tools) and never parsing the old file — a corrupt file is discarded
   * explicitly, the documented recovery path. Returns the reset instant.
   */
  resetMemory(): Promise<{ readonly reset_at: string }>;
  /**
   * The inner text of the `<memory>` prompt section (no wrapper): every
   * non-expired entry of every section, under its heading, in file order
   * — the whole book, the one reading rule.
   */
  buildMemorySection(): Promise<string>;
  /** Bind the off-record flag to the session currently being served. */
  observeSession(sessionId: string): void;
  /** True when writes are refused: flag on and (unbound or this session). */
  isOffRecord(sessionId?: string): boolean;
  getOffRecord(): MemoryOffRecordState;
  setOffRecord(on: boolean): void;
}
