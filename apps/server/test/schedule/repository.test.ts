/**
 * Schedule repository against a real sqlite database in a temporary
 * directory: item CRUD with uniqueness and vocabulary rules, the
 * entry natural key with its idempotent create-or-update, the cascade
 * delete, the inclusive range query, and the lazy open/close lifecycle.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import {
  createScheduleDb,
  type ScheduleDb,
} from "../../src/domains/schedule/db.ts";
import {
  createScheduleRepository,
  type ScheduleRepository,
} from "../../src/domains/schedule/repository.ts";
import type { ScheduleItem } from "../../src/domains/schedule/types.ts";

const dataRoot = mkdtempSync(path.join(tmpdir(), "toby-schedule-repository-"));
const fixedNow = () => Date.parse("2026-11-15T08:00:00.000Z");
const FIXED_UPDATED_AT = "2026-11-15T08:00:00.000Z";

afterAll(async () => {
  rmSync(dataRoot, { recursive: true, force: true });
});

// One isolated database per case: a fresh subdirectory per call. The
// database opens and migrates lazily, exactly as in the app.
let caseCounter = 0;

async function openSchedule(): Promise<{
  db: ScheduleDb;
  repository: ScheduleRepository;
}> {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(dataRoot, `case-${caseCounter}`) },
  });
  const db = createScheduleDb({ config });
  return { db, repository: createScheduleRepository({ db, clock: fixedNow }) };
}

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return { title: "吃饭", statuses: ["是", "否"], ...overrides };
}

describe("schedule repository: items", () => {
  it("inserts items, preserves status order, lists in creation order", async () => {
    const { db, repository } = await openSchedule();
    try {
      const first = await repository.insertItem(item());
      expect(first.outcome).toBe("created");
      if (first.outcome !== "created") throw new Error("unreachable");
      expect(first.item.id).toBeGreaterThan(0);
      expect(first.item.statuses).toEqual(["是", "否"]);
      await repository.insertItem(
        item({ title: "锻炼", statuses: ["完成", "部分", "没做"] }),
      );
      const rows = await repository.listItems();
      expect(rows.map((row) => row.title)).toEqual(["吃饭", "锻炼"]);
    } finally {
      await db.close();
    }
  });

  it("rejects a duplicate title", async () => {
    const { db, repository } = await openSchedule();
    try {
      await repository.insertItem(item());
      const again = await repository.insertItem(item({ statuses: ["甲"] }));
      expect(again).toEqual({ outcome: "duplicateTitle" });
    } finally {
      await db.close();
    }
  });

  it("patches present fields only and reports the before/after pair", async () => {
    const { db, repository } = await openSchedule();
    try {
      const inserted = await repository.insertItem(item());
      if (inserted.outcome !== "created") throw new Error("unreachable");
      const id = inserted.item.id;
      const outcome = await repository.updateItem(id, {
        statuses: ["完成", "部分", "没做"],
      });
      expect(outcome.outcome).toBe("updated");
      if (outcome.outcome !== "updated") throw new Error("unreachable");
      expect(outcome.before.statuses).toEqual(["是", "否"]);
      expect(outcome.after).toEqual({
        id,
        title: "吃饭",
        statuses: ["完成", "部分", "没做"],
        entryCount: 0,
      });
      const [row] = await repository.listItems();
      expect(row).toEqual(outcome.after);
    } finally {
      await db.close();
    }
  });

  it("an unknown item answers missing; a clashing title answers duplicateTitle", async () => {
    const { db, repository } = await openSchedule();
    try {
      await repository.insertItem(item());
      expect(await repository.updateItem(999, { title: "锻炼" })).toEqual({
        outcome: "missing",
      });
      const inserted = await repository.insertItem(item({ title: "锻炼" }));
      if (inserted.outcome !== "created") throw new Error("unreachable");
      const clash = await repository.updateItem(inserted.item.id, {
        title: "吃饭",
      });
      expect(clash).toEqual({ outcome: "duplicateTitle" });
    } finally {
      await db.close();
    }
  });

  it("rejects removing a status an entry still uses, allows adding", async () => {
    const { db, repository } = await openSchedule();
    try {
      const inserted = await repository.insertItem(item());
      if (inserted.outcome !== "created") throw new Error("unreachable");
      const id = inserted.item.id;
      const upsert = await repository.upsertEntry({
        itemId: id,
        date: "2026-11-15",
        status: "否",
      });
      expect(upsert.outcome).toBe("created");
      // "否" is still in use: removing it fails inside the transaction.
      const removed = await repository.updateItem(id, { statuses: ["是"] });
      expect(removed).toEqual({ outcome: "statusInUse", statuses: ["否"] });
      // Adding statuses is always fine; dropping the unused one is too.
      const widened = await repository.updateItem(id, {
        statuses: ["是", "否", "不想吃"],
      });
      expect(widened.outcome).toBe("updated");
      const narrowed = await repository.updateItem(id, {
        statuses: ["是", "否"],
      });
      expect(narrowed.outcome).toBe("updated");
    } finally {
      await db.close();
    }
  });

  it("deletes an item and cascades its entries AND view references in one transaction", async () => {
    const { db, repository } = await openSchedule();
    try {
      const inserted = await repository.insertItem(item());
      if (inserted.outcome !== "created") throw new Error("unreachable");
      const id = inserted.item.id;
      await repository.upsertEntry({
        itemId: id,
        date: "2026-11-14",
        status: "是",
      });
      await repository.upsertEntry({
        itemId: id,
        date: "2026-11-15",
        status: "否",
      });
      // A view that references the item alongside another one.
      await repository.insertView({
        name: "本周",
        type: "list",
        config: { itemIds: [String(id), "7"], sort: "date", group: "item" },
      });
      // A view without the id must stay byte-identical.
      await repository.insertView({
        name: "全部",
        type: "calendar",
        config: { sort: "title", group: "none" },
      });
      const deleted = await repository.deleteItem(id);
      expect(deleted).toEqual({ outcome: "deleted", deletedEntries: 2 });
      expect(await repository.listItems()).toEqual([]);
      expect(
        await repository.listEntryViewsInRange("2026-01-01", "2026-12-31"),
      ).toEqual([]);
      const views = await repository.listViews();
      // The id left the referencing config; an empty list means no filter.
      expect(views[0]).toMatchObject({
        name: "本周",
        config: { itemIds: ["7"], sort: "date", group: "item" },
      });
      expect(views[1]).toEqual({
        id: views[1]!.id,
        name: "全部",
        type: "calendar",
        config: { sort: "title", group: "none" },
      });
      // Dropping the LAST reference removes the empty key entirely.
      const only = await repository.insertItem(item({ title: "锻炼" }));
      if (only.outcome !== "created") throw new Error("unreachable");
      await repository.insertView({
        name: "只有它",
        type: "list",
        config: {
          itemIds: [String(only.item.id)],
          sort: "date",
          group: "none",
        },
      });
      await repository.deleteItem(only.item.id);
      const after = await repository.listViews();
      expect(after.find((view) => view.name === "只有它")?.config).toEqual({
        sort: "date",
        group: "none",
      });
      expect(await repository.deleteItem(id)).toEqual({ outcome: "missing" });
    } finally {
      await db.close();
    }
  });
});

describe("schedule repository: entries", () => {
  async function insertItem(repository: ScheduleRepository): Promise<number> {
    const inserted = await repository.insertItem(item());
    if (inserted.outcome !== "created") throw new Error("unreachable");
    return inserted.item.id;
  }

  it("upserts by the natural key: create once, update in place, idempotent", async () => {
    const { db, repository } = await openSchedule();
    try {
      const itemId = await insertItem(repository);
      const first = await repository.upsertEntry({
        itemId,
        date: "2026-11-15",
        status: "是",
      });
      expect(first.outcome).toBe("created");
      if (first.outcome !== "created") throw new Error("unreachable");
      expect(first.entry).toMatchObject({
        itemId,
        title: "吃饭",
        date: "2026-11-15",
        status: "是",
        updatedAt: FIXED_UPDATED_AT,
      });
      const second = await repository.upsertEntry({
        itemId,
        date: "2026-11-15",
        status: "否",
      });
      expect(second.outcome).toBe("updated");
      if (second.outcome !== "updated") throw new Error("unreachable");
      // The natural key holds: the update rewrote the SAME row.
      expect(second.entry.id).toBe(first.entry.id);
      expect(second.entry.status).toBe("否");
      const [row] = await repository.listEntryViewsInRange(
        "2026-11-15",
        "2026-11-15",
      );
      expect(row).toEqual(second.entry);
    } finally {
      await db.close();
    }
  });

  it("checks the vocabulary and the item inside the write transaction", async () => {
    const { db, repository } = await openSchedule();
    try {
      expect(
        await repository.upsertEntry({
          itemId: 42,
          date: "2026-11-15",
          status: "是",
        }),
      ).toEqual({ outcome: "missingItem" });
      const itemId = await insertItem(repository);
      expect(
        await repository.upsertEntry({
          itemId,
          date: "2026-11-15",
          status: "没做",
        }),
      ).toEqual({ outcome: "statusNotInVocab" });
      expect(
        await repository.listEntryViewsInRange("2026-11-15", "2026-11-15"),
      ).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("deletes one entry and answers whether it existed", async () => {
    const { db, repository } = await openSchedule();
    try {
      const itemId = await insertItem(repository);
      const created = await repository.upsertEntry({
        itemId,
        date: "2026-11-15",
        status: "是",
      });
      if (created.outcome !== "created") throw new Error("unreachable");
      expect(await repository.deleteEntry(created.entry.id)).toBe(true);
      expect(await repository.deleteEntry(created.entry.id)).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("the range query is inclusive on both ends and joined with titles", async () => {
    const { db, repository } = await openSchedule();
    try {
      const itemId = await insertItem(repository);
      const other = await repository.insertItem(item({ title: "锻炼" }));
      if (other.outcome !== "created") throw new Error("unreachable");
      await repository.upsertEntry({
        itemId,
        date: "2026-11-14",
        status: "是",
      });
      await repository.upsertEntry({
        itemId,
        date: "2026-11-15",
        status: "否",
      });
      await repository.upsertEntry({
        itemId,
        date: "2026-11-16",
        status: "是",
      });
      await repository.upsertEntry({
        itemId: other.item.id,
        date: "2026-11-15",
        status: "是",
      });
      const rows = await repository.listEntryViewsInRange(
        "2026-11-15",
        "2026-11-15",
      );
      expect(rows.map((row) => [row.title, row.date])).toEqual([
        ["吃饭", "2026-11-15"],
        ["锻炼", "2026-11-15"],
      ]);
      const wide = await repository.listEntryViewsInRange(
        "2026-11-14",
        "2026-11-16",
      );
      expect(wide.map((row) => row.date)).toEqual([
        "2026-11-14",
        "2026-11-15",
        "2026-11-15",
        "2026-11-16",
      ]);
    } finally {
      await db.close();
    }
  });
});

describe("schedule repository: views", () => {
  const view = {
    name: "本周",
    type: "calendar" as const,
    config: { sort: "date" as const, group: "none" as const },
  };

  it("inserts, lists in creation order, patches, deletes", async () => {
    const { db, repository } = await openSchedule();
    try {
      const first = await repository.insertView(view);
      const second = await repository.insertView({
        name: "全部",
        type: "list",
        config: {
          itemIds: ["1"],
          statuses: ["是"],
          sort: "title",
          group: "item",
        },
      });
      expect(first.id).toBeGreaterThan(0);
      const rows = await repository.listViews();
      expect(rows.map((row) => row.name)).toEqual(["本周", "全部"]);
      expect(rows[1]!).toEqual(second);
      const outcome = await repository.updateView(first.id, {
        name: "改名",
      });
      expect(outcome.outcome).toBe("updated");
      if (outcome.outcome !== "updated") throw new Error("unreachable");
      expect(outcome.before.name).toBe("本周");
      expect(outcome.after).toMatchObject({ name: "改名", type: "calendar" });
      expect(await repository.deleteView(first.id)).toBe(true);
      expect(await repository.deleteView(first.id)).toBe(false);
      expect(await repository.updateView(first.id, { name: "x" })).toEqual({
        outcome: "missing",
      });
    } finally {
      await db.close();
    }
  });

  it("a closed database stays closed instead of reopening", async () => {
    const { db, repository } = await openSchedule();
    await repository.listItems();
    await db.close();
    await expect(repository.listItems()).rejects.toThrow(/closed/);
    // Closing again is harmless.
    await db.close();
  });
});
