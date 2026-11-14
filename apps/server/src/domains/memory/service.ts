/**
 * The memory service: every rule of reading and writing memory lives here
 * — keyword search with the substring rule, replace-vs-duplicate,
 * receipts, expiry, the whole-book prompt section, and the in-process
 * off-record gate (single-user product; same closure-store pattern as the
 * chat rate limiter). All storage goes through the repository; one write
 * is the repository's one validated cycle.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import {
  memoryEntryProblem,
  renderMemoryLine,
  serializeMemoryMarkdown,
} from "./parser.ts";
import type { MemoryRepository } from "./repository.ts";
import type { MemoryEntry } from "./types.ts";
import type { MemoryService } from "./types.ts";
import { MemoryInputError, MemoryRequestError } from "./errors.ts";

/** The entry not found inside the same cycle it is being written. */
function notFoundError(line: string): MemoryRequestError {
  return new MemoryRequestError(
    "ENTRY_NOT_FOUND",
    404,
    `没有找到这条记忆: ${line}`,
  );
}

export function createMemoryService(deps: {
  repository: MemoryRepository;
  clock: Clock;
}): MemoryService {
  const { repository, clock } = deps;

  // The off-record gate: one session-scoped flag, in-process by design.
  const offRecord: { sessionId: string | null; on: boolean } = {
    sessionId: null,
    on: false,
  };

  function nowIso(): string {
    return new Date(clock()).toISOString();
  }

  function isExpired(entry: MemoryEntry, today: string): boolean {
    return entry.until !== undefined && entry.until < today;
  }

  /** The one match rule, deliberately dumb: case-insensitive substring
   * over the entry text — headings and 至 markers never match. */
  function matchesKeyword(entry: MemoryEntry, needle: string): boolean {
    return entry.text.toLowerCase().includes(needle);
  }

  /** Trim-normalized entry; throws MemoryInputError on any bad field. */
  function normalizeEntry(entry: {
    section: string;
    text: string;
    until?: string;
  }): MemoryEntry {
    const candidate: MemoryEntry = {
      section: entry.section.trim(),
      text: entry.text.trim(),
      ...(entry.until === undefined ? {} : { until: entry.until.trim() }),
    };
    const problem = memoryEntryProblem(candidate);
    if (problem !== null) {
      throw new MemoryInputError(problem);
    }
    return candidate;
  }

  /** Non-expired keyword hits, with the needle pre-normalized. */
  async function nonExpiredMatches(
    keyword: string,
  ): Promise<readonly MemoryEntry[]> {
    const entries = await repository.list();
    const today = repository.today();
    return entries.filter(
      (entry) => !isExpired(entry, today) && matchesKeyword(entry, keyword),
    );
  }

  return {
    async readFile() {
      // The honest file read behind the read-only page: raw bytes, never
      // re-serialized (a synced copy would become a second source of
      // truth) and never repaired — a corrupt file's bytes come back as
      // they are; parsing is the caller's problem.
      const raw = await repository.readRaw();
      return raw ?? serializeMemoryMarkdown({ entries: [] });
    },

    async remember(input) {
      const entry = normalizeEntry(input);
      const after = renderMemoryLine(entry);
      const replaceKeyword = input.replaceKeyword?.trim();

      if (replaceKeyword !== undefined && replaceKeyword.length > 0) {
        const hits = await nonExpiredMatches(replaceKeyword.toLowerCase());
        if (hits.length > 1) {
          // Several hits: refuse and list the candidates — ask, never guess.
          return {
            kind: "ambiguous",
            candidates: hits.map(renderMemoryLine),
          };
        }
        if (hits.length === 1) {
          const before = renderMemoryLine(hits[0] as MemoryEntry);
          await repository.mutate((list) => {
            // Re-locate inside the write cycle so the replace lands on
            // one consistent snapshot of the file.
            const index = list.findIndex((e) => renderMemoryLine(e) === before);
            if (index < 0) {
              throw notFoundError(before);
            }
            const copy = [...list];
            copy[index] = entry;
            return copy;
          });
          return {
            kind: "receipt",
            receipt: {
              action: "updated",
              section: entry.section,
              before,
              after,
              created_at: nowIso(),
            },
          };
        }
        // Zero hits: a remember-with-replace treats it as a new append.
      }

      // Duplicate check across the whole book: the identical rendered
      // line anywhere — any section — answers already-remembered.
      const entries = await repository.list();
      if (entries.some((e) => renderMemoryLine(e) === after)) {
        return { kind: "already-remembered", line: after };
      }
      await repository.mutate((list) => [...list, entry]);
      return {
        kind: "receipt",
        receipt: {
          action: "remembered",
          section: entry.section,
          after,
          created_at: nowIso(),
        },
      };
    },

    async forget(keyword) {
      const needle = keyword.trim().toLowerCase();
      const hits = await nonExpiredMatches(needle);
      if (hits.length === 0) {
        return { kind: "nothing-matched" };
      }
      if (hits.length > 1) {
        return { kind: "ambiguous", candidates: hits.map(renderMemoryLine) };
      }
      const hit = hits[0] as MemoryEntry;
      const before = renderMemoryLine(hit);
      await repository.mutate((list) => {
        const index = list.findIndex((e) => renderMemoryLine(e) === before);
        if (index < 0) {
          throw notFoundError(before);
        }
        return [...list.slice(0, index), ...list.slice(index + 1)];
      });
      return {
        kind: "receipt",
        receipt: {
          action: "forgot",
          section: hit.section,
          before,
          created_at: nowIso(),
        },
      };
    },

    async resetMemory() {
      // Human maintenance, deliberately outside the AI-tool surface: the
      // off-record gate guards the tools, not this route. The reset never
      // parses the old file — a corrupt file is discarded explicitly (the
      // documented recovery path), and a healthy file resets the same way.
      await repository.reset();
      return { reset_at: nowIso() };
    },

    async buildMemorySection() {
      // The whole book, always open: every non-expired entry of every
      // section, under its heading, in file order.
      const entries = await repository.list();
      const today = repository.today();
      const live = entries.filter((entry) => !isExpired(entry, today));
      const blocks: string[] = [];
      let lines: string[] = [];
      let section: string | null = null;
      for (const entry of live) {
        if (entry.section !== section) {
          if (lines.length > 0) {
            blocks.push(lines.join("\n"));
          }
          section = entry.section;
          lines = [`## ${entry.section}`];
        }
        lines.push(renderMemoryLine(entry));
      }
      if (lines.length > 0) {
        blocks.push(lines.join("\n"));
      }
      return blocks.join("\n\n");
    },

    observeSession(sessionId) {
      // First observation (null → bound) keeps the flag; a different
      // session resets it — the flag is scoped to one session.
      if (offRecord.sessionId !== sessionId && offRecord.sessionId !== null) {
        offRecord.on = false;
      }
      offRecord.sessionId = sessionId;
    },

    isOffRecord(sessionId) {
      if (!offRecord.on) {
        return false;
      }
      return offRecord.sessionId === null || sessionId === offRecord.sessionId;
    },

    getOffRecord() {
      return { ...offRecord };
    },

    setOffRecord(on) {
      offRecord.on = on;
    },
  };
}
