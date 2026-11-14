/**
 * Memory domain types: the pure vocabulary shared by the parser, the
 * repository, the service and the routes. Plain data only — this file
 * stays import-free (the boundary tests enforce it). Response shapes are
 * mirrored by hand in packages/contract/src/memory-client.ts — change
 * both sides together.
 */

/** The three memory types; the section heading decides who sees an entry. */
export type MemoryType = "约定" | "关于我" | "人物";

/**
 * One remembered line: a sentence, optionally attributed to a named
 * person, with an optional expiry. This is the whole entry — no id, no
 * source, no timestamps in the file (docs/decisions/personal-agent-memory.md).
 */
export interface MemoryEntry {
  readonly type: MemoryType;
  /** The line body, one sentence. */
  readonly text: string;
  /** 人物 only: the leading name before the colon. */
  readonly name?: string;
  /** Optional expiry, "YYYY-MM-DD"; an expired entry appears nowhere. */
  readonly until?: string;
}

/** An entry as the page and recall see it: expiry resolved against today. */
export interface MemoryEntryView extends MemoryEntry {
  /** until < today (UTC calendar date): the entry appears nowhere else. */
  readonly expired: boolean;
}

/** The parsed file: every line validated, entries in file order. */
export interface ParsedMemory {
  readonly entries: readonly MemoryEntry[];
}

/**
 * The receipt of one landed change — the accountability card. before/after
 * are the rendered file lines (`- text (至 date)` / `- name: text`), so the
 * card quotes the file itself.
 */
export interface MemoryReceipt {
  readonly action: "remembered" | "updated" | "forgot";
  readonly type: MemoryType;
  readonly before?: string;
  readonly after?: string;
  /** UTC ISO instant of the write, from the domain clock. */
  readonly created_at: string;
}

/**
 * The closed result union of every memory write. Receipt-carrying outcomes
 * have landed; the other kinds are refusals the caller (tool or route)
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
 * The memory service: reads (page, export, recall, prompt section) and
 * writes (remember / forget / exact replace) over the repository, plus the
 * in-process off-record gate. Declared here so later lanes (chat tools,
 * prompt builders) can compile against the port without importing the
 * module graph.
 */
export interface MemoryService {
  /** Every entry, 约定 → 关于我 → 人物, file order within a type. */
  list(): Promise<{ entries: readonly MemoryEntryView[] }>;
  /** The raw MEMORY.md content; serialize(empty) when the file is missing. */
  exportMarkdown(): Promise<string>;
  /** Non-expired entries matching a keyword substring, all types. */
  recall(keyword: string): Promise<readonly MemoryEntryView[]>;
  /**
   * Append one entry, or replace the one non-expired hit of
   * replaceKeyword. Returns a receipt, an ambiguity, or an
   * already-remembered answer; bad input throws MemoryInputError.
   */
  remember(input: {
    readonly type: MemoryType;
    readonly text: string;
    readonly name?: string;
    readonly until?: string;
    readonly replaceKeyword?: string;
  }): Promise<MemoryWriteResult>;
  /** Delete the one non-expired keyword hit; zero hits answer nothing-matched. */
  forget(keyword: string): Promise<MemoryWriteResult>;
  /**
   * Replace or delete one entry by exact rendered line — the page's veto
   * buttons. Works on expired entries too; zero matches throw
   * ENTRY_NOT_FOUND, a duplicated line throws AMBIGUOUS_ENTRY.
   */
  replaceExact(
    current: MemoryEntry,
    next: MemoryEntry | null,
  ): Promise<MemoryWriteResult>;
  /**
   * The inner text of the `<memory>` prompt section (no wrapper), from
   * non-expired entries only.
   */
  buildMemorySection(opts: {
    readonly conventions: boolean;
    readonly peopleIndex: boolean;
    readonly aboutIndex: boolean;
    readonly sentence?: string;
  }): Promise<string>;
  /** Bind the off-record flag to the session currently being served. */
  observeSession(sessionId: string): void;
  /** True when writes are refused: flag on and (unbound or this session). */
  isOffRecord(sessionId?: string): boolean;
  getOffRecord(): MemoryOffRecordState;
  setOffRecord(on: boolean): void;
}
