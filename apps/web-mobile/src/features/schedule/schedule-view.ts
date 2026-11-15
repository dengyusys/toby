import { ApiError } from "@toby/contract";
import type {
  ScheduleErrorCode,
  ScheduleViewConfig,
  ScheduleEntryView,
} from "@toby/contract";

const errors: Record<ScheduleErrorCode, string> = {
  SCHEDULE_ITEM_NOT_FOUND: "这个事项不存在，可能已被删除。",
  SCHEDULE_ENTRY_NOT_FOUND: "这条记录不存在，可能已被清除。",
  SCHEDULE_VIEW_NOT_FOUND: "这个视图不存在，可能已被删除。已切换到全部事项。",
  SCHEDULE_ITEM_DUPLICATE: "已有同名事项，请换一个名称。",
  SCHEDULE_STATUS_IN_USE:
    "有记录仍在使用这个状态，不能移除或改名。请保留后再保存。",
  SCHEDULE_INVALID_ITEM:
    "事项信息不正确，请检查名称和状态词。状态词不能为空或重复。",
  SCHEDULE_INVALID_DATE: "日期不正确，请重新选择日期。",
  SCHEDULE_INVALID_STATUS: "这个状态不在事项的状态词中，请重新选择。",
  SCHEDULE_INVALID_VIEW_CONFIG:
    "视图设置不正确，请检查事项、状态、排序和分组。",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError)
    return (
      errors[error.code as ScheduleErrorCode] ??
      "暂时无法完成操作，请稍后重试。"
    );
  return error instanceof TypeError
    ? "网络连接失败，请重试。"
    : "暂时无法完成操作，请稍后重试。";
}
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function monthRange(month: string) {
  const [year = 0, number = 1] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(year, number, 0).getDate()}`,
  };
}
export function moveMonth(month: string, delta: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function dateLabel(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return `${month}月${day}日 周${"日一二三四五六"[new Date(year, month - 1, day).getDay()]}`;
}
export const allConfig: ScheduleViewConfig = { sort: "date", group: "none" };
export function matches(
  entry: ScheduleEntryView,
  config: ScheduleViewConfig,
): boolean {
  return (
    (!config.itemIds?.length ||
      config.itemIds.includes(String(entry.itemId))) &&
    (!config.statuses?.length || config.statuses.includes(entry.status))
  );
}
export function statusClass(statuses: string[], status: string): string {
  const index = statuses.indexOf(status);
  if (statuses.length < 2 || index < 0) return "bg-accent-soft text-foreground";
  return index === 0
    ? "bg-status-good-bg text-status-good"
    : index === statuses.length - 1
      ? "bg-status-low-bg text-status-low"
      : "bg-status-middle-bg text-status-middle";
}
export const fieldClass =
  "min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";
