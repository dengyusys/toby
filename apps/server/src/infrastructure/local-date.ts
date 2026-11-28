/**
 * Calendar formatting in a named time zone, defined once.
 *
 * The AI prompts pin "today" per run — relative dates like "昨天" are
 * resolved against it — and the ledger stores dates as "YYYY-MM-DD"
 * calendar strings. Both read these helpers, so a single definition
 * decides what "today" means for a given instant. The zone is the one the
 * client reported with its request; absent, the server's own — which in a
 * container is UTC and would date China's mornings to yesterday.
 */

import { z } from "zod";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** `UTC`, or an IANA `Area/Location` such as `Asia/Shanghai`. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/;

/**
 * Whether a zone name can format a calendar date. The shape check runs
 * first so a bare offset ("+08:00") is refused even where Intl would take
 * it: the client reports where it is, not how far its clock is from UTC.
 */
export function isTimeZone(value: string): boolean {
  if (value !== "UTC" && !IANA_TIME_ZONE.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A client-reported zone on the wire; an unusable name is a 400. */
export const TIME_ZONE_SCHEMA = z.string().refine(isTimeZone, {
  message: "time_zone must be UTC or a valid IANA time zone",
});

/**
 * The zone one operation resolves "today" in: the one the client sent,
 * else the server process's own.
 */
export function resolveTimeZone(requested: string | undefined): string {
  return requested ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The calendar date of `date` in `timeZone`, as "YYYY-MM-DD". */
export function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year").padStart(4, "0")}-${field("month")}-${field("day")}`;
}

/** The label the agent prompts put in <context>: "2026-11-06(星期五)". */
export function localDayLabel(date: Date, timeZone: string): string {
  const day = localDate(date, timeZone);
  // A calendar date's weekday is the same in every zone, so the date
  // string is read back at UTC midnight and cannot shift to a neighbour.
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${day}(星期${weekday})`;
}
