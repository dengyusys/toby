/**
 * The time zone vocabulary against pinned instants: the same instant is a
 * different day per zone (the issue's UTC-evening / China-morning case),
 * daylight saving follows the zone rather than a fixed offset, a zone
 * name is judged on its shape and on Intl's own acceptance, and the
 * fallback zone is the server process's. Instants are pinned in UTC and
 * zones are passed explicitly, so the suite reads the same on a CI runner
 * in UTC and on a machine in Asia/Shanghai.
 */

import { describe, expect, it } from "vitest";
import {
  isTimeZone,
  localDate,
  localDayLabel,
  resolveTimeZone,
} from "../../src/infrastructure/local-date.ts";

/** 23:30 UTC on Oct 30 is already Oct 31 in China: the issue's case. */
const SHENZHEN_MORNING = new Date("2026-10-30T23:30:00.000Z");

describe("localDate", () => {
  it("dates one instant by the zone, not by the server's own", () => {
    expect(localDate(SHENZHEN_MORNING, "Asia/Shanghai")).toBe("2026-10-31");
    expect(localDate(SHENZHEN_MORNING, "UTC")).toBe("2026-10-30");
    expect(localDayLabel(SHENZHEN_MORNING, "Asia/Shanghai")).toBe(
      "2026-10-31(星期六)",
    );
    expect(localDayLabel(SHENZHEN_MORNING, "UTC")).toBe("2026-10-30(星期五)");
  });

  it("follows daylight saving instead of a fixed offset", () => {
    // New York is UTC-4 in July and UTC-5 in January; 30 minutes after
    // 03:00 UTC is still the day before in both.
    expect(
      localDate(new Date("2026-07-01T03:30:00Z"), "America/New_York"),
    ).toBe("2026-06-30");
    expect(
      localDate(new Date("2026-01-01T04:30:00Z"), "America/New_York"),
    ).toBe("2025-12-31");
  });
});

describe("isTimeZone", () => {
  it("accepts UTC and IANA names Intl can format", () => {
    for (const zone of [
      "UTC",
      "Asia/Shanghai",
      "America/Argentina/Buenos_Aires",
      "Etc/GMT+8",
    ]) {
      expect(isTimeZone(zone)).toBe(true);
    }
  });

  it("refuses offsets, abbreviations, and unknown names", () => {
    for (const zone of [
      "",
      "+08:00",
      "CST",
      "GMT",
      "Asia/Shanghai ",
      "asia-shanghai",
      "Mars/Olympus",
    ]) {
      expect(isTimeZone(zone)).toBe(false);
    }
  });
});

describe("resolveTimeZone", () => {
  it("takes the client's zone and falls back to the server's own", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolveTimeZone(undefined)).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});
