/**
 * Schedule repository: hand-written SQL over the domain database (db.ts
 * owns the connection and schema). Every write is one transaction, and
 * the cross-row rules the store must guarantee live inside those
 * transactions: unique titles, the (item_id, date) natural key, status
 * vocabulary membership at write time, and the cascade delete of an
 * item's entries.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { ScheduleDb } from "./db.ts";
import type {
  ScheduleEntryPut,
  ScheduleEntryView,
  ScheduleItem,
  ScheduleItemPatch,
  ScheduleItemRow,
  ScheduleView,
  ScheduleViewPatch,
} from "./types.ts";

/** Raw item row as the driver returns it: statuses as JSON text. */
interface ItemRecord {
  id: number;
  title: string;
  statuses: string;
  /** Present on reads that count entries; constructed rows set it directly. */
  entryCount?: number;
}

/** Raw view row as the driver returns it: config as JSON text. */
interface ViewRecord {
  id: number;
  name: string;
  type: string;
  config: string;
}

function itemRowFromRecord(record: ItemRecord): ScheduleItemRow {
  return {
    id: record.id,
    title: record.title,
    statuses: JSON.parse(record.statuses) as string[],
    entryCount: record.entryCount ?? 0,
  };
}

function viewFromRecord(record: ViewRecord): ScheduleView {
  return {
    id: record.id,
    name: record.name,
    type: record.type === "list" ? "list" : "calendar",
    config: JSON.parse(record.config) as ScheduleView["config"],
  };
}

/** A copy of the config without its itemIds key (absent = no filter). */
function omitItemIds(config: ScheduleView["config"]): ScheduleView["config"] {
  // The config shape is closed: rebuilding without itemIds loses nothing.
  return { statuses: config.statuses, sort: config.sort, group: config.group };
}

export type ItemInsertResult =
  | { readonly outcome: "created"; readonly item: ScheduleItemRow }
  | { readonly outcome: "duplicateTitle" };

export type ItemUpdateOutcome =
  | {
      readonly outcome: "updated";
      readonly before: ScheduleItemRow;
      readonly after: ScheduleItemRow;
    }
  | { readonly outcome: "missing" }
  | { readonly outcome: "duplicateTitle" }
  | { readonly outcome: "statusInUse"; readonly statuses: readonly string[] };

export type ItemDeleteOutcome =
  | { readonly outcome: "deleted"; readonly deletedEntries: number }
  | { readonly outcome: "missing" };

export type EntryUpsertOutcome =
  | {
      readonly outcome: "created";
      readonly entry: ScheduleEntryView;
    }
  | {
      readonly outcome: "updated";
      readonly entry: ScheduleEntryView;
    }
  | { readonly outcome: "missingItem" }
  | { readonly outcome: "statusNotInVocab" };

/**
 * The natural-key delete behind the AI clear op: either the removed
 * row's id and its item's title (one transaction), or "missing" when
 * nothing is stored for the pair — clearing an absent record is an
 * honest no-op, not an error.
 */
export type EntryNaturalDeleteOutcome =
  | { readonly outcome: "deleted"; readonly id: number; readonly title: string }
  | { readonly outcome: "missing" };

export type ViewUpdateOutcome =
  | {
      readonly outcome: "updated";
      readonly before: ScheduleView;
      readonly after: ScheduleView;
    }
  | { readonly outcome: "missing" };

export interface ScheduleRepository {
  insertItem(item: ScheduleItem): Promise<ItemInsertResult>;
  /** Items in creation order. */
  listItems(): Promise<readonly ScheduleItemRow[]>;
  /**
   * Patch one item inside one transaction: the row is read there, the
   * merged result is duplicate-checked, and a removed status is
   * rejected while any entry of the item still uses it.
   */
  updateItem(id: number, patch: ScheduleItemPatch): Promise<ItemUpdateOutcome>;
  /**
   * Delete one item and its entries in the same transaction; reports
   * how many entries went with it. Missing ids answer "missing".
   */
  deleteItem(id: number): Promise<ItemDeleteOutcome>;
  /**
   * Create-or-update one entry by its natural key (itemId, date). The
   * item's existence and the status's membership in its current
   * vocabulary are both checked inside the same transaction as the
   * write, so a concurrent vocabulary change cannot slip through.
   * `updated_at` is stamped by the repository's clock; the full landed
   * row (item title included) is the answer either way.
   */
  upsertEntry(entry: ScheduleEntryPut): Promise<EntryUpsertOutcome>;
  /** Delete one entry by id; true when the row existed. */
  deleteEntry(id: number): Promise<boolean>;
  /**
   * Delete one entry by its natural key (itemId, date) in one
   * transaction, answering the removed row's id and its item's title —
   * or "missing" when the pair has no stored entry.
   */
  deleteEntryByNaturalKey(
    itemId: number,
    date: string,
  ): Promise<EntryNaturalDeleteOutcome>;
  /** Entries with from <= date <= to (inclusive), joined with titles. */
  listEntryViewsInRange(
    from: string,
    to: string,
  ): Promise<readonly ScheduleEntryView[]>;
  insertView(view: Omit<ScheduleView, "id">): Promise<ScheduleView>;
  /** Views in creation order. */
  listViews(): Promise<readonly ScheduleView[]>;
  updateView(id: number, patch: ScheduleViewPatch): Promise<ViewUpdateOutcome>;
  /** Delete one view by id; true when the row existed. */
  deleteView(id: number): Promise<boolean>;
}

export function createScheduleRepository(deps: {
  db: ScheduleDb;
  clock: Clock;
}): ScheduleRepository {
  const { db, clock } = deps;

  return {
    async insertItem(item) {
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [existing] = await tx.query<{ id: number }>(
          "SELECT id FROM schedule_items WHERE title = ?",
          [item.title],
        );
        if (existing !== undefined) {
          return { outcome: "duplicateTitle" as const };
        }
        const result = await tx.run(
          "INSERT INTO schedule_items (title, statuses) VALUES (?, ?)",
          [item.title, JSON.stringify(item.statuses)],
        );
        return {
          outcome: "created" as const,
          item: {
            id: result.insertId ?? 0,
            title: item.title,
            statuses: item.statuses,
            entryCount: 0,
          },
        };
      });
    },

    async listItems() {
      const handle = await db.open();
      const records = await handle.query<ItemRecord>(
        `SELECT i.id AS id, i.title AS title, i.statuses AS statuses,
                (SELECT COUNT(*) FROM schedule_entries e WHERE e.item_id = i.id) AS entryCount
         FROM schedule_items i
         ORDER BY i.id ASC`,
      );
      return records.map(itemRowFromRecord);
    },

    async updateItem(id, patch) {
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [beforeRecord] = await tx.query<ItemRecord>(
          `SELECT i.id AS id, i.title AS title, i.statuses AS statuses,
                  (SELECT COUNT(*) FROM schedule_entries e WHERE e.item_id = i.id) AS entryCount
           FROM schedule_items i WHERE i.id = ?`,
          [id],
        );
        if (beforeRecord === undefined) {
          return { outcome: "missing" as const };
        }
        const before = itemRowFromRecord(beforeRecord);
        const after: ScheduleItemRow = {
          id,
          title: patch.title ?? before.title,
          statuses: patch.statuses ?? before.statuses,
          // Status edits never change entry counts, and the in-use
          // guard below rejects removals while entries still carry one.
          entryCount: before.entryCount,
        };
        // Title uniqueness (excluding this row itself).
        const [duplicate] = await tx.query<{ id: number }>(
          "SELECT id FROM schedule_items WHERE title = ? AND id != ?",
          [after.title, id],
        );
        if (duplicate !== undefined) {
          return { outcome: "duplicateTitle" as const };
        }
        // A status leaving the vocabulary is rejected while entries of
        // this item still carry it.
        const removed = before.statuses.filter(
          (status) => !after.statuses.includes(status),
        );
        if (removed.length > 0) {
          const used = await tx.query<{ status: string }>(
            "SELECT DISTINCT status FROM schedule_entries WHERE item_id = ?",
            [id],
          );
          const stillUsed = used
            .map((row) => row.status)
            .filter((status) => removed.includes(status));
          if (stillUsed.length > 0) {
            return { outcome: "statusInUse" as const, statuses: stillUsed };
          }
        }
        await tx.run(
          "UPDATE schedule_items SET title = ?, statuses = ? WHERE id = ?",
          [after.title, JSON.stringify(after.statuses), id],
        );
        return { outcome: "updated" as const, before, after };
      });
    },

    async deleteItem(id) {
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [item] = await tx.query<{ id: number }>(
          "SELECT id FROM schedule_items WHERE id = ?",
          [id],
        );
        if (item === undefined) {
          return { outcome: "missing" as const };
        }
        const [counted] = await tx.query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM schedule_entries WHERE item_id = ?",
          [id],
        );
        const deletedEntries = counted?.n ?? 0;
        // The cascade: the item's entries go in the SAME transaction —
        // no intermediate state where entries outlive their item.
        await tx.run("DELETE FROM schedule_entries WHERE item_id = ?", [id]);
        await tx.run("DELETE FROM schedule_items WHERE id = ?", [id]);
        // The id also leaves every saved view's config.itemIds in the
        // SAME transaction: a dangling reference never exists.
        const views = await tx.query<ViewRecord>(
          "SELECT id, name, type, config FROM schedule_views",
        );
        const idText = String(id);
        for (const record of views) {
          const config = JSON.parse(record.config) as ScheduleView["config"];
          if (
            config.itemIds === undefined ||
            !config.itemIds.includes(idText)
          ) {
            continue;
          }
          const itemIds = config.itemIds.filter((ref) => ref !== idText);
          const cleaned: ScheduleView["config"] =
            itemIds.length > 0 ? { ...config, itemIds } : omitItemIds(config);
          await tx.run("UPDATE schedule_views SET config = ? WHERE id = ?", [
            JSON.stringify(cleaned),
            record.id,
          ]);
        }
        return { outcome: "deleted" as const, deletedEntries };
      });
    },

    async upsertEntry(entry) {
      const updatedAt = new Date(clock()).toISOString();
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [item] = await tx.query<ItemRecord>(
          "SELECT id, title, statuses FROM schedule_items WHERE id = ?",
          [entry.itemId],
        );
        if (item === undefined) {
          return { outcome: "missingItem" as const };
        }
        const vocabulary = JSON.parse(item.statuses) as string[];
        if (!vocabulary.includes(entry.status)) {
          return { outcome: "statusNotInVocab" as const };
        }
        const landed = (id: number): ScheduleEntryView => ({
          id,
          itemId: entry.itemId,
          title: item.title,
          date: entry.date,
          status: entry.status,
          updatedAt,
        });
        const [existing] = await tx.query<{ id: number }>(
          "SELECT id FROM schedule_entries WHERE item_id = ? AND date = ?",
          [entry.itemId, entry.date],
        );
        if (existing !== undefined) {
          await tx.run(
            "UPDATE schedule_entries SET status = ?, updated_at = ? WHERE id = ?",
            [entry.status, updatedAt, existing.id],
          );
          return { outcome: "updated" as const, entry: landed(existing.id) };
        }
        const result = await tx.run(
          "INSERT INTO schedule_entries (item_id, date, status, updated_at) VALUES (?, ?, ?, ?)",
          [entry.itemId, entry.date, entry.status, updatedAt],
        );
        return {
          outcome: "created" as const,
          entry: landed(result.insertId ?? 0),
        };
      });
    },

    async deleteEntry(id) {
      const handle = await db.open();
      const result = await handle.run(
        "DELETE FROM schedule_entries WHERE id = ?",
        [id],
      );
      return result.changes > 0;
    },

    async deleteEntryByNaturalKey(itemId, date) {
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [existing] = await tx.query<{ id: number; title: string }>(
          `SELECT e.id AS id, i.title AS title
           FROM schedule_entries e
           JOIN schedule_items i ON i.id = e.item_id
           WHERE e.item_id = ? AND e.date = ?`,
          [itemId, date],
        );
        if (existing === undefined) {
          return { outcome: "missing" as const };
        }
        await tx.run("DELETE FROM schedule_entries WHERE id = ?", [
          existing.id,
        ]);
        return {
          outcome: "deleted" as const,
          id: existing.id,
          title: existing.title,
        };
      });
    },

    async listEntryViewsInRange(from, to) {
      const handle = await db.open();
      return handle.query<ScheduleEntryView>(
        `SELECT e.id AS id, e.item_id AS itemId, i.title AS title,
                e.date AS date, e.status AS status, e.updated_at AS updatedAt
         FROM schedule_entries e
         JOIN schedule_items i ON i.id = e.item_id
         WHERE e.date >= ? AND e.date <= ?
         ORDER BY e.date ASC, e.id ASC`,
        [from, to],
      );
    },

    async insertView(view) {
      const handle = await db.open();
      const result = await handle.run(
        "INSERT INTO schedule_views (name, type, config) VALUES (?, ?, ?)",
        [view.name, view.type, JSON.stringify(view.config)],
      );
      return { id: result.insertId ?? 0, ...view };
    },

    async listViews() {
      const handle = await db.open();
      const records = await handle.query<ViewRecord>(
        "SELECT id, name, type, config FROM schedule_views ORDER BY id ASC",
      );
      return records.map(viewFromRecord);
    },

    async updateView(id, patch) {
      const handle = await db.open();
      return handle.transaction(async (tx) => {
        const [beforeRecord] = await tx.query<ViewRecord>(
          "SELECT id, name, type, config FROM schedule_views WHERE id = ?",
          [id],
        );
        if (beforeRecord === undefined) {
          return { outcome: "missing" as const };
        }
        const before = viewFromRecord(beforeRecord);
        const after: ScheduleView = {
          id,
          name: patch.name ?? before.name,
          type: patch.type ?? before.type,
          config: patch.config ?? before.config,
        };
        await tx.run(
          "UPDATE schedule_views SET name = ?, type = ?, config = ? WHERE id = ?",
          [after.name, after.type, JSON.stringify(after.config), id],
        );
        return { outcome: "updated" as const, before, after };
      });
    },

    async deleteView(id) {
      const handle = await db.open();
      const result = await handle.run(
        "DELETE FROM schedule_views WHERE id = ?",
        [id],
      );
      return result.changes > 0;
    },
  };
}
