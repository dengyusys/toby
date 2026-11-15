import { ApiError } from "@toby/contract";
import type {
  ScheduleEntryView,
  ScheduleErrorCode,
  ScheduleItemRow,
  ScheduleViewConfig,
} from "@toby/contract";

export const DEFAULT_CONFIG: ScheduleViewConfig = {
  sort: "date",
  group: "none",
};
export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const ERRORS: Record<ScheduleErrorCode, string> = {
  SCHEDULE_ITEM_NOT_FOUND: "这个事项不存在，可能已被删除。",
  SCHEDULE_ENTRY_NOT_FOUND: "这条记录不存在，可能已被清除。",
  SCHEDULE_VIEW_NOT_FOUND: "这个视图不存在，可能已被删除。请切换到全部事项。",
  SCHEDULE_ITEM_DUPLICATE: "已有同名事项，请换一个名称。",
  SCHEDULE_STATUS_IN_USE:
    "有记录仍在使用这个状态，不能移除或改名。请保留后再保存。",
  SCHEDULE_INVALID_ITEM:
    "事项信息不正确：名称需为1–50字，状态词需为1–8项、每项1–30字，且不能重复。",
  SCHEDULE_INVALID_DATE: "日期不正确，请重新选择日期。",
  SCHEDULE_INVALID_STATUS: "这个状态不在事项的状态词中，请重新选择。",
  SCHEDULE_INVALID_VIEW_CONFIG:
    "视图设置不正确，请检查事项、状态、排序和分组。",
};
export function describeError(error: unknown): string {
  if (error instanceof ApiError)
    return (
      ERRORS[error.code as ScheduleErrorCode] ??
      "暂时无法完成操作，请稍后重试。"
    );
  return "网络连接失败，请重试。";
}
export function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function monthRange(month: string) {
  const [year, number] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(year!, number!, 0).getDate()}`,
  };
}
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const value = new Date(year!, number! - 1 + delta, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${year} 年 ${Number(number)} 月`;
}
export function statusClass(
  item: ScheduleItemRow | undefined,
  status: string,
): string {
  const index = item?.statuses.indexOf(status) ?? -1;
  if (!item || item.statuses.length < 2 || index < 0)
    return "text-muted-foreground bg-muted";
  if (index === 0) return "text-success bg-success/10";
  if (index === item.statuses.length - 1)
    return "text-schedule-low bg-schedule-low/10";
  return "text-schedule-middle bg-schedule-middle/10";
}
export function filterEntries(
  entries: ScheduleEntryView[],
  config: ScheduleViewConfig,
) {
  return entries
    .filter(
      (row) =>
        (!config.itemIds?.length ||
          config.itemIds.includes(String(row.itemId))) &&
        (!config.statuses?.length || config.statuses.includes(row.status)),
    )
    .sort(
      (a, b) =>
        (config.sort === "date"
          ? a.date.localeCompare(b.date)
          : a.title.localeCompare(b.title, "zh-CN")) || a.id - b.id,
    );
}
