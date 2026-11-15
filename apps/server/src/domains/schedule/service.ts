/**
 * Schedule service: the use-case layer tying validation and the
 * repository together. Every write is one validated, transactional
 * repository write: the repository transaction answers with what
 * landed, and the service maps the outcomes onto the domain's closed
 * error codes. The range list is a plain inclusive date-window query —
 * no timezone conversion anywhere.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import {
  AiError,
  AI_UNCONFIGURED_MESSAGE,
} from "../../infrastructure/model/errors.ts";
import type {
  EntryNaturalDeleteOutcome,
  EntryUpsertOutcome,
  ItemDeleteOutcome,
  ItemInsertResult,
  ItemUpdateOutcome,
  ScheduleRepository,
  ViewUpdateOutcome,
} from "./repository.ts";
import { ScheduleRequestError } from "./errors.ts";
import type {
  ScheduleExtractor,
  ScheduleFollowUp,
  ScheduleOp,
} from "./extraction.ts";
import {
  normalizeEntryPut,
  normalizeItem,
  normalizeItemPatch,
  normalizeViewBody,
  normalizeViewPatch,
  resolveRange,
} from "./validation.ts";
import type {
  ScheduleClearedEntry,
  ScheduleDeleteResult,
  ScheduleEntryPutResult,
  ScheduleEntryView,
  ScheduleItemRow,
  ScheduleView,
  ScheduleWriteReceipt,
} from "./types.ts";

/** The item statuses that answer a vocabulary-conflict rejection. */
function statusInUseError(statuses: readonly string[]): ScheduleRequestError {
  const quoted = statuses.map((status) => `"${status}"`).join(", ");
  return new ScheduleRequestError(
    "SCHEDULE_STATUS_IN_USE",
    409,
    `status is still used by entries and cannot leave the vocabulary: ${quoted}`,
  );
}

/**
 * A landed AI write receipt, or the AI asking one clarifying question —
 * exactly one of these per sentence. Domain-level outcomes are values
 * here, never throws; the ambiguity law resolves first and lands
 * nothing on a question.
 */
export type ScheduleWriteResult = ScheduleWriteReceipt | ScheduleFollowUp;

export interface ScheduleService {
  listItems(): Promise<{ items: readonly ScheduleItemRow[] }>;
  /** `raw` has passed the route's envelope schema; semantics live here. */
  createItem(raw: unknown): Promise<ScheduleItemRow>;
  updateItem(rawId: string, rawPatch: unknown): Promise<ScheduleItemRow>;
  /** Deletes the item and its entries in one transaction. */
  deleteItem(rawId: string): Promise<{ deletedEntries: number }>;
  /**
   * Create-or-update one entry by its natural key (itemId, date);
   * idempotent for identical payloads. Answers the full landed row
   * plus whether the write created the pair. Last write wins.
   */
  putEntry(raw: unknown): Promise<ScheduleEntryPutResult>;
  deleteEntry(rawId: string): Promise<ScheduleDeleteResult>;
  /**
   * The one-sentence AI write path (the only consumer is the chat
   * capability): extract → resolve every op against the registered
   * items → land each op as its own validated, transactional write.
   * One ambiguous op asks and lands nothing.
   */
  write(body: { text: string }): Promise<ScheduleWriteResult>;
  /** Inclusive [from, to] date range, flat and ordered by date, then id. */
  listEntries(
    fromRaw: string | undefined,
    toRaw: string | undefined,
  ): Promise<{
    from: string;
    to: string;
    entries: readonly ScheduleEntryView[];
  }>;
  listViews(): Promise<{ views: readonly ScheduleView[] }>;
  createView(raw: unknown): Promise<ScheduleView>;
  updateView(rawId: string, rawPatch: unknown): Promise<ScheduleView>;
  deleteView(rawId: string): Promise<ScheduleDeleteResult>;
}

export function createScheduleService(deps: {
  repository: ScheduleRepository;
  clock: Clock;
  /**
   * Absent while AI is unconfigured: the one-sentence path then answers
   * the shared unconfigured error (which chat maps to its honest
   * notice). Schedule has no HTTP text-write route, so its closed wire
   * union carries no AI codes — the capability handles the surfaces.
   */
  extractor?: ScheduleExtractor;
}): ScheduleService {
  const { repository, clock, extractor } = deps;

  /** A path id for the item routes; the domain validates what it may be. */
  function parseItemId(rawId: string): number {
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id) || id < 1) {
      throw new ScheduleRequestError(
        "SCHEDULE_INVALID_ITEM",
        400,
        "item id must be a positive integer",
      );
    }
    return id;
  }

  /**
   * A path id for the entry and view routes. The closed union has no
   * generic invalid code for these resources, so an id that cannot name
   * a row answers the row's not-found code.
   */
  function parseRowId(
    rawId: string,
    code: "SCHEDULE_ENTRY_NOT_FOUND" | "SCHEDULE_VIEW_NOT_FOUND",
  ): number {
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id) || id < 1) {
      throw new ScheduleRequestError(code, 404, "id does not name a row");
    }
    return id;
  }

  function mapUpsert(outcome: EntryUpsertOutcome): ScheduleEntryPutResult {
    if (outcome.outcome === "created") {
      return { ...outcome.entry, created: true };
    }
    if (outcome.outcome === "updated") {
      return { ...outcome.entry, created: false };
    }
    if (outcome.outcome === "missingItem") {
      throw new ScheduleRequestError(
        "SCHEDULE_ITEM_NOT_FOUND",
        404,
        "item does not exist",
      );
    }
    throw new ScheduleRequestError(
      "SCHEDULE_INVALID_STATUS",
      400,
      "status is not in the item's current vocabulary",
    );
  }

  function mapItemInsert(result: ItemInsertResult): ScheduleItemRow {
    if (result.outcome === "created") {
      return result.item;
    }
    throw new ScheduleRequestError(
      "SCHEDULE_ITEM_DUPLICATE",
      409,
      "an item with this title already exists",
    );
  }

  function mapItemUpdate(outcome: ItemUpdateOutcome): ScheduleItemRow {
    if (outcome.outcome === "updated") {
      return outcome.after;
    }
    if (outcome.outcome === "missing") {
      throw new ScheduleRequestError(
        "SCHEDULE_ITEM_NOT_FOUND",
        404,
        "item does not exist (it may already be deleted)",
      );
    }
    if (outcome.outcome === "duplicateTitle") {
      throw new ScheduleRequestError(
        "SCHEDULE_ITEM_DUPLICATE",
        409,
        "an item with this title already exists",
      );
    }
    throw statusInUseError(outcome.statuses);
  }

  function mapItemDelete(outcome: ItemDeleteOutcome): {
    deletedEntries: number;
  } {
    if (outcome.outcome === "missing") {
      throw new ScheduleRequestError(
        "SCHEDULE_ITEM_NOT_FOUND",
        404,
        "item does not exist (it may already be deleted)",
      );
    }
    return { deletedEntries: outcome.deletedEntries };
  }

  function mapViewUpdate(outcome: ViewUpdateOutcome): ScheduleView {
    if (outcome.outcome === "updated") {
      return outcome.after;
    }
    throw new ScheduleRequestError(
      "SCHEDULE_VIEW_NOT_FOUND",
      404,
      "view does not exist (it may already be deleted)",
    );
  }

  // The one-sentence branch: extract → (question | ops) → receipt.
  async function writeFromText(rawText: string): Promise<ScheduleWriteResult> {
    const text = rawText.trim();
    if (!text) {
      // Chat guarantees a non-empty trimmed sentence; this is defense in
      // depth for future callers. No HTTP surface exposes this path, so
      // no wire code applies — a plain error keeps chat's honest
      // fallback notice.
      throw new Error("text must not be empty");
    }
    if (!extractor) {
      // AI unconfigured: the shared error chat maps to its unconfigured
      // notice. No domain-local drift — the copy lives on the AI port's
      // errors, like every AI path's.
      throw new AiError("unconfigured", AI_UNCONFIGURED_MESSAGE);
    }
    const draft = await extractor.extract(text, new Date(clock()));
    if ("question" in draft) {
      return draft;
    }
    return applyOps(draft.ops, draft.memoryReceipts);
  }

  /**
   * Resolve every op against the registered items BEFORE any write: one
   * ambiguous op (unknown item, status outside the vocabulary) asks and
   * lands nothing — never a partial application. The writes themselves
   * are per-op validated transactions, exactly as the HTTP PUT path
   * runs them; a vocabulary change that slips in between the resolve
   * and the write still hits the transaction's own membership check.
   */
  async function applyOps(
    ops: readonly ScheduleOp[],
    memoryReceipts: readonly unknown[] | undefined,
  ): Promise<ScheduleWriteResult> {
    const items = await repository.listItems();
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const op of ops) {
      const item = byId.get(op.itemId);
      if (item === undefined) {
        return {
          question: `没有找到 id 为 ${op.itemId} 的事项。请在界面里确认事项名称后再说一次。`,
        };
      }
      if (op.kind === "put" && !item.statuses.includes(op.status)) {
        return {
          question: `「${op.status}」不在「${item.title}」的状态词表里(可选:${item.statuses.join("、")})。请在界面里对照词表后再说一次。`,
        };
      }
    }
    const entries: ScheduleEntryPutResult[] = [];
    const cleared: ScheduleClearedEntry[] = [];
    for (const op of ops) {
      if (op.kind === "put") {
        entries.push(
          mapUpsert(
            await repository.upsertEntry({
              itemId: op.itemId,
              date: op.date,
              status: op.status,
            }),
          ),
        );
      } else {
        const deleted: EntryNaturalDeleteOutcome =
          await repository.deleteEntryByNaturalKey(op.itemId, op.date);
        if (deleted.outcome === "deleted") {
          cleared.push({
            id: deleted.id,
            itemId: op.itemId,
            title: deleted.title,
            date: op.date,
          });
        }
        // A clear of an absent record is an honest no-op, not an error.
      }
    }
    const receipt: ScheduleWriteReceipt = {
      written: entries.length,
      entries,
      cleared,
      createdAt: new Date(clock()).toISOString(),
    };
    return memoryReceipts === undefined
      ? receipt
      : { ...receipt, memoryReceipts };
  }

  return {
    async listItems() {
      return { items: await repository.listItems() };
    },

    async createItem(raw) {
      const item = normalizeItem(raw);
      return mapItemInsert(await repository.insertItem(item));
    },

    async updateItem(rawId, rawPatch) {
      const id = parseItemId(rawId);
      // Throws SCHEDULE_INVALID_ITEM on a bad or empty patch.
      const patch = normalizeItemPatch(rawPatch);
      return mapItemUpdate(await repository.updateItem(id, patch));
    },

    async deleteItem(rawId) {
      const id = parseItemId(rawId);
      return mapItemDelete(await repository.deleteItem(id));
    },

    async putEntry(raw) {
      // Shape and value semantics first; the vocabulary membership and
      // the item's existence ride inside the write transaction itself.
      const entry = normalizeEntryPut(raw);
      return mapUpsert(await repository.upsertEntry(entry));
    },

    async deleteEntry(rawId) {
      const id = parseRowId(rawId, "SCHEDULE_ENTRY_NOT_FOUND");
      const deleted = await repository.deleteEntry(id);
      if (!deleted) {
        throw new ScheduleRequestError(
          "SCHEDULE_ENTRY_NOT_FOUND",
          404,
          "entry does not exist (it may already be deleted)",
        );
      }
      return {
        id,
        action: "deleted",
        deletedAt: new Date(clock()).toISOString(),
      };
    },

    async write(body) {
      return writeFromText(body.text);
    },

    async listEntries(fromRaw, toRaw) {
      if (fromRaw === undefined || toRaw === undefined) {
        throw new ScheduleRequestError(
          "SCHEDULE_INVALID_DATE",
          400,
          'from and to are required as "YYYY-MM-DD" strings',
        );
      }
      // Both ends required, ordered, span-capped — the shared rule.
      const { from, to } = resolveRange(fromRaw, toRaw);
      return {
        from,
        to,
        entries: await repository.listEntryViewsInRange(from, to),
      };
    },

    async listViews() {
      return { views: await repository.listViews() };
    },

    async createView(raw) {
      const view = normalizeViewBody(raw);
      return repository.insertView(view);
    },

    async updateView(rawId, rawPatch) {
      const id = parseRowId(rawId, "SCHEDULE_VIEW_NOT_FOUND");
      // Throws SCHEDULE_INVALID_VIEW_CONFIG on a bad or empty patch.
      const patch = normalizeViewPatch(rawPatch);
      return mapViewUpdate(await repository.updateView(id, patch));
    },

    async deleteView(rawId) {
      const id = parseRowId(rawId, "SCHEDULE_VIEW_NOT_FOUND");
      const deleted = await repository.deleteView(id);
      if (!deleted) {
        throw new ScheduleRequestError(
          "SCHEDULE_VIEW_NOT_FOUND",
          404,
          "view does not exist (it may already be deleted)",
        );
      }
      return {
        id,
        action: "deleted",
        deletedAt: new Date(clock()).toISOString(),
      };
    },
  };
}
