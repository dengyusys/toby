/**
 * Entry validation and normalization: every bad shape must throw
 * INVALID_ENTRY and every good shape must normalize deterministically —
 * money parses digit-wise into cents, dates survive calendar checking.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES_PER_WRITE,
  normalizeEntries,
  normalizeEntry,
  normalizeEntryPatch,
  parseAmountToCents,
  parseEntryDate,
} from "../../src/domains/ledger/validation.ts";

describe("parseAmountToCents", () => {
  it("parses integers, one and two decimals into cents", () => {
    expect(parseAmountToCents("25")).toBe(2500);
    expect(parseAmountToCents("25.5")).toBe(2550);
    expect(parseAmountToCents("25.50")).toBe(2550);
    expect(parseAmountToCents("0")).toBe(0);
    expect(parseAmountToCents("0.05")).toBe(5);
    expect(parseAmountToCents(25.5)).toBe(2550);
    expect(parseAmountToCents(0)).toBe(0);
    expect(parseAmountToCents(" 12.34 ")).toBe(1234);
  });

  it("rejects negatives, three decimals, garbage and non-finite forms", () => {
    for (const bad of [
      -5,
      "-5",
      "12.345",
      "abc",
      "",
      "1e3",
      NaN,
      Infinity,
      null,
      {},
      true,
      "12,34",
    ]) {
      expect(() => parseAmountToCents(bad)).toThrow(/amount/);
    }
  });

  it("rejects amounts beyond the safe integer cent range", () => {
    expect(() => parseAmountToCents("90071992547409.93")).toThrow(/too large/);
  });
});

describe("parseEntryDate", () => {
  it("accepts real calendar dates, including leap years and backfill dates", () => {
    expect(parseEntryDate("2026-10-20")).toBe("2026-10-20");
    expect(parseEntryDate("2024-02-29")).toBe("2024-02-29");
    expect(parseEntryDate("1900-01-01")).toBe("1900-01-01");
    expect(parseEntryDate("2099-12-31")).toBe("2099-12-31");
    expect(parseEntryDate(" 2026-01-02 ")).toBe("2026-01-02");
  });

  it("rejects impossible dates and non-ISO formats", () => {
    for (const bad of [
      "2026-02-30",
      "2023-02-29", // not a leap year
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "2026-4-5",
      "2026/10/20",
      "10.20.2026",
      "",
      20261020,
      null,
    ]) {
      expect(() => parseEntryDate(bad)).toThrow(/date/);
    }
  });
});

describe("normalizeEntry", () => {
  const goodEntry = {
    date: "2026-10-20",
    type: "expense",
    category: " 餐饮 ",
    amount: "25.5",
    note: " 午饭 ",
  };

  it("normalizes: trims text, defaults note, keeps amount as cents", () => {
    expect(normalizeEntry(goodEntry)).toEqual({
      date: "2026-10-20",
      type: "expense",
      category: "餐饮",
      amount: 2550,
      note: "午饭",
    });
  });

  it("note is optional and defaults to empty", () => {
    const { note, ...withoutNote } = goodEntry;
    void note;
    expect(normalizeEntry(withoutNote).note).toBe("");
  });

  it("rejects missing or empty required fields, bad type, oversized text", () => {
    expect(() => normalizeEntry({ ...goodEntry, category: "  " })).toThrow(
      /category/,
    );
    expect(() => normalizeEntry({ ...goodEntry, type: "花销" })).toThrow(
      /type/,
    );
    expect(() => normalizeEntry({ ...goodEntry, amount: "12.345" })).toThrow(
      /amount/,
    );
    expect(() => normalizeEntry({ ...goodEntry, date: "2026-02-31" })).toThrow(
      /date/,
    );
    expect(() =>
      normalizeEntry({ ...goodEntry, note: "x".repeat(201) }),
    ).toThrow(/note/);
    expect(() => normalizeEntry({ ...goodEntry, note: 5 })).toThrow(/note/);
    expect(() => normalizeEntry("not-an-object")).toThrow(/entry/);
    expect(() => normalizeEntry(undefined)).toThrow(/entry/);
  });
});

describe("normalizeEntries", () => {
  it("accepts 1..10 entries and preserves order", () => {
    const entries = Array.from({ length: MAX_ENTRIES_PER_WRITE }, (_, i) => ({
      date: "2026-10-20",
      type: "expense",
      category: `cat-${i}`,
      amount: i + 1,
    }));
    const normalized = normalizeEntries(entries);
    expect(normalized).toHaveLength(MAX_ENTRIES_PER_WRITE);
    expect(normalized[0]!.category).toBe("cat-0");
    expect(normalized[9]!.amount).toBe(1000);
  });

  it("rejects empty and oversized batches, and non-arrays", () => {
    expect(() => normalizeEntries([])).toThrow(/1 to 10/);
    expect(() => normalizeEntries({})).toThrow(/array/);
    const eleven = Array.from({ length: 11 }, () => ({
      date: "2026-10-20",
      type: "expense",
      category: "c",
      amount: 1,
    }));
    expect(() => normalizeEntries(eleven)).toThrow(/1 to 10/);
  });
});

describe("normalizeEntryPatch", () => {
  it("normalizes present fields and leaves absent ones out entirely", () => {
    expect(normalizeEntryPatch({ amount: "35", category: " 交通 " })).toEqual({
      amount: 3500,
      category: "交通",
    });
    expect(normalizeEntryPatch({ type: "income", date: "2026-10-21" })).toEqual(
      { type: "income", date: "2026-10-21" },
    );
  });

  it("an empty note clears it", () => {
    expect(normalizeEntryPatch({ note: "" })).toEqual({ note: "" });
    expect(normalizeEntryPatch({ note: " 要报销 " })).toEqual({
      note: "要报销",
    });
  });

  it("an empty patch is rejected — an update must change something", () => {
    expect(() => normalizeEntryPatch({})).toThrow(/at least one field/);
  });

  it("present fields get the same semantics as a fresh entry", () => {
    expect(() => normalizeEntryPatch({ amount: "12.345" })).toThrow(/amount/);
    expect(() => normalizeEntryPatch({ date: "2026-02-30" })).toThrow(/date/);
    expect(() => normalizeEntryPatch({ category: "   " })).toThrow(/category/);
    expect(() => normalizeEntryPatch({ type: "saving" })).toThrow(/type/);
    expect(() => normalizeEntryPatch({ note: "x".repeat(201) })).toThrow(
      /note/,
    );
    expect(() => normalizeEntryPatch("nope")).toThrow(/JSON object/);
  });
});
