/**
 * The memory service: every rule of reading and writing memory lives here
 * — keyword search with recall's substring rule, replace-vs-duplicate,
 * receipts, expiry, the layered prompt section, and the in-process
 * off-record gate (single-user product; same closure-store pattern as the
 * chat rate limiter). All storage goes through the repository; one write
 * is the repository's one validated cycle.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import {
  MEMORY_SECTION_ORDER,
  memoryEntryProblem,
  renderMemoryLine,
  serializeMemoryMarkdown,
} from "./parser.ts";
import type { MemoryRepository } from "./repository.ts";
import type { MemoryEntry, MemoryType } from "./types.ts";
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

  /** Recall's rule, deliberately dumb: case-insensitive substring over
   * names and entry text — type headers and 至 markers never match. */
  function matchesKeyword(entry: MemoryEntry, needle: string): boolean {
    if (entry.text.toLowerCase().includes(needle)) {
      return true;
    }
    return (
      entry.name !== undefined && entry.name.toLowerCase().includes(needle)
    );
  }

  /** Trim-normalized entry; throws MemoryInputError on any bad field. */
  function normalizeEntry(entry: {
    type: MemoryType;
    text: string;
    name?: string;
    until?: string;
  }): MemoryEntry {
    const candidate: MemoryEntry = {
      type: entry.type,
      text: entry.text.trim(),
      ...(entry.name === undefined ? {} : { name: entry.name.trim() }),
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
    async list() {
      const entries = await repository.list();
      const today = repository.today();
      // 约定 → 关于我 → 人物, file order within a type (the file already
      // stores sections in this order; regrouping keeps it true even so).
      const ordered = MEMORY_SECTION_ORDER.flatMap((type) =>
        entries.filter((entry) => entry.type === type),
      );
      return {
        entries: ordered.map((entry) => ({
          ...entry,
          expired: isExpired(entry, today),
        })),
      };
    },

    async exportMarkdown() {
      // The on-demand snapshot is the raw file; never written anywhere
      // else (a synced copy would become a second source of truth).
      const raw = await repository.readRaw();
      return raw ?? serializeMemoryMarkdown({ entries: [] });
    },

    async recall(keyword) {
      // An empty keyword flips through the whole book: every non-expired
      // entry, so 「你记得我什么」 lists them all verbatim.
      const needle = keyword.trim().toLowerCase();
      const entries = await repository.list();
      const today = repository.today();
      return entries
        .filter((entry) => !isExpired(entry, today))
        .filter((entry) => needle.length === 0 || matchesKeyword(entry, needle))
        .map((entry) => ({ ...entry, expired: false }));
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
              type: entry.type,
              before,
              after,
              created_at: nowIso(),
            },
          };
        }
        // Zero hits: a remember-with-replace treats it as a new append.
      }

      const entries = await repository.list();
      if (entries.some((e) => renderMemoryLine(e) === after)) {
        return { kind: "already-remembered", line: after };
      }
      await repository.mutate((list) => [...list, entry]);
      return {
        kind: "receipt",
        receipt: {
          action: "remembered",
          type: entry.type,
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
          type: hit.type,
          before,
          created_at: nowIso(),
        },
      };
    },

    async replaceExact(current, next) {
      const normalizedCurrent = normalizeEntry(current);
      const normalizedNext = next === null ? null : normalizeEntry(next);
      // Exact full-line match: type + name + text + until together.
      const target = renderMemoryLine(normalizedCurrent);

      const entries = await repository.list();
      const matches = entries.filter((e) => renderMemoryLine(e) === target);
      if (matches.length === 0) {
        throw notFoundError(target);
      }
      if (matches.length > 1) {
        throw new MemoryRequestError(
          "AMBIGUOUS_ENTRY",
          409,
          `这条记忆出现了 ${matches.length} 次，请先去重: ${target}`,
        );
      }

      const after =
        normalizedNext === null ? undefined : renderMemoryLine(normalizedNext);
      await repository.mutate((list) => {
        const index = list.findIndex((e) => renderMemoryLine(e) === target);
        if (index < 0) {
          throw notFoundError(target);
        }
        if (normalizedNext === null) {
          return [...list.slice(0, index), ...list.slice(index + 1)];
        }
        const copy = [...list];
        copy[index] = normalizedNext;
        return copy;
      });
      return {
        kind: "receipt",
        receipt: {
          action: normalizedNext === null ? "forgot" : "updated",
          type: (normalizedNext ?? normalizedCurrent).type,
          before: target,
          ...(after === undefined ? {} : { after }),
          created_at: nowIso(),
        },
      };
    },

    async buildMemorySection(opts) {
      const entries = await repository.list();
      const today = repository.today();
      const live = entries.filter((entry) => !isExpired(entry, today));
      const blocks: string[][] = [];

      if (opts.conventions) {
        const lines = live
          .filter((entry) => entry.type === "约定")
          .map(renderMemoryLine);
        if (lines.length > 0) {
          blocks.push(["## 约定", ...lines]);
        }
      }

      const people = live.filter((entry) => entry.type === "人物");
      const about = live.filter((entry) => entry.type === "关于我");
      // The 记忆索引 heading names the recall tool, so it is only for
      // agents that carry the tools (indexes requested without a
      // sentence). Database-writing agents read with a sentence in hand:
      // they get the 人物 full-entry hits below instead, never the index.
      if (
        (opts.peopleIndex || opts.aboutIndex) &&
        opts.sentence === undefined
      ) {
        if (
          (opts.peopleIndex && people.length > 0) ||
          (opts.aboutIndex && about.length > 0) ||
          (opts.peopleIndex && opts.aboutIndex)
        ) {
          const indexLines = ["## 记忆索引 — 详情用 recall 工具查询"];
          if (opts.peopleIndex && people.length > 0) {
            indexLines.push(
              `人物: ${people.map((entry) => entry.name ?? "").join("、")}`,
            );
          }
          if (opts.aboutIndex && about.length > 0) {
            indexLines.push(
              `关于我: ${about.map((entry) => entry.text).join("；")}`,
            );
          }
          blocks.push(indexLines);
        }
      }

      if (opts.peopleIndex && opts.sentence !== undefined) {
        // The write-time hit mechanism: names are exact tokens, a literal
        // match almost never misses; false hits are the model's job.
        const sentence = opts.sentence.trim().toLowerCase();
        const hits =
          sentence.length === 0
            ? []
            : people.filter(
                (entry) =>
                  entry.name !== undefined &&
                  entry.name.length > 0 &&
                  sentence.includes(entry.name.toLowerCase()),
              );
        if (hits.length > 0) {
          blocks.push(["## 人物", ...hits.map(renderMemoryLine)]);
        }
      }

      // Everything requested came up empty: no section at all.
      if (blocks.length === 0) {
        return "";
      }
      return blocks.map((block) => block.join("\n")).join("\n\n");
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
