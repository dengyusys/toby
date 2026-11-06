/**
 * Calendar formatting in the server's local timezone, defined once.
 *
 * The AI prompts pin "today" per run — relative dates like "昨天" are
 * resolved against it — and the ledger stores dates as local
 * "YYYY-MM-DD" strings. Both read these helpers, so a single definition
 * decides what "today" means for a given instant.
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** The local calendar date as "YYYY-MM-DD". */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The local weekday in Chinese, e.g. "星期五". */
export function localWeekday(date: Date): string {
  return `星期${WEEKDAYS[date.getDay()]}`;
}

/** The label the agent prompts put in <context>: "2026-11-06(星期五)". */
export function localDayLabel(date: Date): string {
  return `${localDate(date)}(${localWeekday(date)})`;
}
