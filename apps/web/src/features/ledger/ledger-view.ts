/**
 * Pure view helpers shared by the ledger feature components of this app:
 * date and month math, the calendar grid builder, money and countdown
 * formatting, proposal-error wording, the structured-form state, and the
 * shared input/button class strings. Per docs/decisions/web-split-dual-
 * apps.md the mobile app keeps its own copy of this module; nothing is
 * shared across the two apps from here.
 */

import { ApiError } from "@toby/contract";

export interface EntryFormState {
  date: string;
  type: "expense" | "income";
  category: string;
  account: string;
  amount: string;
  note: string;
}

export type ProposalOutcome = "committed" | "cancelled";

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayLocal(): string {
  return toLocalIso(new Date());
}

export function initialForm(): EntryFormState {
  return {
    date: todayLocal(),
    type: "expense",
    category: "",
    account: "",
    amount: "",
    note: "",
  };
}

/** Cents are the wire format; the page shows decimal yuan. */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function weekdayOf(date: string): string {
  return WEEKDAY_NAMES[new Date(`${date}T00:00:00`).getDay()]!;
}

/** "YYYY-MM" → "2026 年 9 月" (leading zero dropped) for the pager header. */
export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_ENTRY":
        return `录入有误:${error.message}`;
      case "INVALID_MONTH":
        return "月份参数不正确";
      case "PROPOSAL_CANCELLED":
        return "提案已取消,无法记入";
      case "PROPOSAL_COMMITTED":
        return "提案已记入";
      case "PROPOSAL_EXPIRED":
        return "提案已过期,请重新录入";
      case "PROPOSAL_NOT_FOUND":
        return "提案不存在或已被清理";
      case "AI_UNAVAILABLE":
        return "AI 未配置:需要在服务端设置 TOBY_AI_MODEL(格式 provider/model,如 zai/glm-4.7)";
      case "AI_REQUEST_FAILED":
        return "AI 服务出错,请稍后再试";
      default:
        return error.message;
    }
  }
  return "请求失败,请稍后重试";
}

export const inputClass =
  "mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const primaryButtonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50";
