/**
 * The memory repository: the port every read and write goes through —
 * domain code compiles against this, the Markdown file is only its
 * current implementation (docs/decisions/personal-agent-memory.md). One
 * write is one validated cycle — read, parse, edit, cap check, serialize,
 * atomic replace — so a file that no longer parses refuses the write
 * instead of being repaired.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { MemoryRequestError } from "./errors.ts";
import type { MemoryFile } from "./memory-file.ts";
import type { MemoryEntry } from "./types.ts";

/** Hard cap over all types together: full means refuse, never truncate. */
export const MAX_ENTRIES = 500;

export interface MemoryRepository {
  /** Parsed entries in file order; a corrupt file throws. */
  list(): Promise<readonly MemoryEntry[]>;
  /** Raw file content, or null when the file does not exist yet. */
  readRaw(): Promise<string | null>;
  /** The clock's instant as a UTC "YYYY-MM-DD" calendar date. */
  today(): string;
  /**
   * The one validated write: the edit runs against a freshly parsed list
   * and the result is cap-checked, serialized and atomically replaced in
   * the same cycle. Returns the entries as written.
   */
  mutate(
    edit: (entries: MemoryEntry[]) => MemoryEntry[],
  ): Promise<readonly MemoryEntry[]>;
  /**
   * The maintenance reset: one full-file atomic replace with the empty
   * book. Deliberately skips the read-parse cycle — a corrupt file is
   * discarded explicitly (the documented recovery path), never repaired
   * in place.
   */
  reset(): Promise<void>;
}

export function createMemoryRepository(deps: {
  memoryFile: MemoryFile;
  clock: Clock;
}): MemoryRepository {
  return {
    async list() {
      return (await deps.memoryFile.read()).entries;
    },
    readRaw() {
      return deps.memoryFile.readRaw();
    },
    today() {
      // Expiry is a date-level, not instant-level, idea: UTC calendar date.
      return new Date(deps.clock()).toISOString().slice(0, 10);
    },
    async mutate(edit) {
      const current = await deps.memoryFile.read();
      const next = edit([...current.entries]);
      if (next.length > MAX_ENTRIES) {
        // Full means refusal plus a question — never silent truncation,
        // never summarization.
        throw new MemoryRequestError(
          "LIMIT_REACHED",
          409,
          `记忆已满（最多 ${MAX_ENTRIES} 条）——该忘点什么？`,
        );
      }
      await deps.memoryFile.write({ entries: next });
      return next;
    },
    reset() {
      // The empty book serializes to the empty file, which parses as the
      // empty book — one atomic replace, no parse of the old content.
      return deps.memoryFile.write({ entries: [] });
    },
  };
}
