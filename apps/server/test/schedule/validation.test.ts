/**
 * Schedule validation: the trust boundary at the unit level. Every
 * rejected payload answers the resource's own closed error code with
 * zero writes; every accepted one comes out fully normalized (trimmed,
 * deduped, real calendar dates).
 */

import { describe, expect, it } from "vitest";
import {
  normalizeEntryPut,
  normalizeItem,
  normalizeItemPatch,
  normalizeStatuses,
  normalizeViewBody,
  normalizeViewConfig,
  normalizeViewPatch,
  parseScheduleDate,
} from "../../src/domains/schedule/validation.ts";
import { ScheduleInputError } from "../../src/domains/schedule/errors.ts";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ScheduleInputError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected the call to throw ScheduleInputError");
}

describe("schedule validation: dates", () => {
  it("accepts real calendar dates, leap years included", () => {
    expect(parseScheduleDate("2026-11-15")).toBe("2026-11-15");
    expect(parseScheduleDate("2028-02-29")).toBe("2028-02-29");
    expect(parseScheduleDate(" 2026-02-28 ")).toBe("2026-02-28");
    expect(parseScheduleDate("0001-01-01")).toBe("0001-01-01");
  });
  it("rejects non-dates with SCHEDULE_INVALID_DATE", () => {
    for (const value of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-2",
      "2026/11/15",
      "20261115",
      "",
      "  ",
      5,
      undefined,
    ]) {
      expect(codeOf(() => parseScheduleDate(value))).toBe(
        "SCHEDULE_INVALID_DATE",
      );
    }
  });
});

describe("schedule validation: items", () => {
  it("normalizes a valid item: trimmed title, trimmed unique statuses", () => {
    expect(
      normalizeItem({ title: " 吃饭 ", statuses: [" 是 ", "否"] }),
    ).toEqual({ title: "吃饭", statuses: ["是", "否"] });
    expect(
      normalizeItem({
        title: "锻炼",
        statuses: ["完成", "部分", "没做"],
      }),
    ).toEqual({ title: "锻炼", statuses: ["完成", "部分", "没做"] });
  });

  it("rejects bad titles with SCHEDULE_INVALID_ITEM", () => {
    for (const raw of [
      { statuses: ["是"] },
      { title: "   ", statuses: ["是"] },
      { title: 5, statuses: ["是"] },
      { title: "x".repeat(51), statuses: ["是"] },
      {},
    ]) {
      expect(codeOf(() => normalizeItem(raw))).toBe("SCHEDULE_INVALID_ITEM");
    }
    // The bound itself is inclusive: exactly 50 characters pass.
    expect(normalizeItem({ title: "x".repeat(50), statuses: ["是"] })).toEqual({
      title: "x".repeat(50),
      statuses: ["是"],
    });
  });

  it("enforces the vocabulary bounds: 1..8 unique non-empty entries", () => {
    expect(codeOf(() => normalizeItem({ title: "x", statuses: [] }))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
    expect(
      codeOf(() =>
        normalizeStatuses(Array.from({ length: 9 }, (_, i) => `s${i}`)),
      ),
    ).toBe("SCHEDULE_INVALID_ITEM");
    expect(codeOf(() => normalizeStatuses(["是", " 是 "]))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
    expect(codeOf(() => normalizeStatuses(["是", ""]))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
    expect(codeOf(() => normalizeStatuses(["是", 5]))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
    expect(codeOf(() => normalizeStatuses("是"))).toBe("SCHEDULE_INVALID_ITEM");
    // The per-status bound is inclusive at 30 characters.
    expect(normalizeStatuses(["x".repeat(30)])).toEqual(["x".repeat(30)]);
    expect(codeOf(() => normalizeStatuses(["x".repeat(31)]))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
  });

  it("patches reject the empty patch and keep per-field semantics", () => {
    expect(codeOf(() => normalizeItemPatch({}))).toBe("SCHEDULE_INVALID_ITEM");
    expect(codeOf(() => normalizeItemPatch({ foo: 1 }))).toBe(
      "SCHEDULE_INVALID_ITEM",
    );
    expect(normalizeItemPatch({ title: " 新名 " })).toEqual({
      title: "新名",
    });
    expect(normalizeItemPatch({ statuses: ["甲", "乙"] })).toEqual({
      statuses: ["甲", "乙"],
    });
    expect(normalizeItemPatch({ title: "x", statuses: ["是"] })).toEqual({
      title: "x",
      statuses: ["是"],
    });
  });
});

describe("schedule validation: entry PUT bodies", () => {
  const valid = { itemId: 1, date: "2026-11-15", status: "是" };

  it("accepts a valid body unchanged (the date is the date)", () => {
    expect(normalizeEntryPut(valid)).toEqual(valid);
    expect(normalizeEntryPut({ ...valid, date: " 2026-11-15 " })).toEqual(
      valid,
    );
    expect(normalizeEntryPut({ ...valid, status: " 是 " })).toEqual(valid);
  });

  it("rejects bad itemIds with SCHEDULE_INVALID_ITEM", () => {
    for (const itemId of ["1", 0, -1, 1.5, undefined]) {
      expect(codeOf(() => normalizeEntryPut({ ...valid, itemId }))).toBe(
        "SCHEDULE_INVALID_ITEM",
      );
    }
  });

  it("rejects bad dates with SCHEDULE_INVALID_DATE", () => {
    for (const date of ["2026-02-30", "tomorrow", 5, undefined]) {
      expect(codeOf(() => normalizeEntryPut({ ...valid, date }))).toBe(
        "SCHEDULE_INVALID_DATE",
      );
    }
  });

  it("rejects bad statuses with SCHEDULE_INVALID_STATUS", () => {
    for (const status of ["", "   ", 5, undefined, "x".repeat(31)]) {
      expect(codeOf(() => normalizeEntryPut({ ...valid, status }))).toBe(
        "SCHEDULE_INVALID_STATUS",
      );
    }
  });
});

describe("schedule validation: view configs", () => {
  it("accepts the closed shape and normalizes it", () => {
    expect(normalizeViewConfig({ sort: "date", group: "none" })).toEqual({
      sort: "date",
      group: "none",
    });
    expect(
      normalizeViewConfig({
        itemIds: ["3", "7"],
        statuses: [" 完成 "],
        sort: "title",
        group: "item",
      }),
    ).toEqual({
      itemIds: ["3", "7"],
      statuses: ["完成"],
      sort: "title",
      group: "item",
    });
  });

  it("rejects unknown fields, wrong enums and garbage itemIds", () => {
    for (const config of [
      { sort: "date", group: "none", color: "red" }, // unknown field
      { sort: "size", group: "none" }, // bad sort
      { sort: "date", group: "tag" }, // bad group
      { group: "none" }, // missing required sort
      { sort: "date" }, // missing required group
      { sort: "date", group: "none", itemIds: ["0"] },
      { sort: "date", group: "none", itemIds: ["x"] },
      { sort: "date", group: "none", itemIds: [-3] },
      { sort: "date", group: "none", statuses: [" "] },
      "not an object",
      undefined,
    ]) {
      expect(codeOf(() => normalizeViewConfig(config))).toBe(
        "SCHEDULE_INVALID_VIEW_CONFIG",
      );
    }
  });

  it("view bodies and patches follow the same rules", () => {
    const body = {
      name: " 本周 ",
      type: "calendar",
      config: { sort: "date", group: "none" },
    };
    expect(normalizeViewBody(body)).toEqual({
      name: "本周",
      type: "calendar",
      config: { sort: "date", group: "none" },
    });
    for (const raw of [
      { ...body, name: "  " },
      { ...body, type: "table" },
      { ...body, config: { sort: "date" } },
      { name: "x", type: "calendar" }, // config missing
      { name: "x", config: { sort: "date", group: "none" } }, // type missing
      { type: "calendar", config: { sort: "date", group: "none" } }, // name missing
    ]) {
      expect(codeOf(() => normalizeViewBody(raw))).toBe(
        "SCHEDULE_INVALID_VIEW_CONFIG",
      );
    }
    expect(codeOf(() => normalizeViewPatch({}))).toBe(
      "SCHEDULE_INVALID_VIEW_CONFIG",
    );
    expect(normalizeViewPatch({ name: " 新名 " })).toEqual({ name: "新名" });
    expect(normalizeViewPatch({ type: "list" })).toEqual({ type: "list" });
    expect(
      normalizeViewPatch({ config: { sort: "title", group: "status" } }),
    ).toEqual({ config: { sort: "title", group: "status" } });
  });
});
