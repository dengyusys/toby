/**
 * Pure view helpers shared by the ledger feature components of the mobile
 * app: date and month math, money and countdown formatting, receipt-error
 * wording, and the mobile card button class strings. Per
 * docs/decisions/web-split-dual-apps.md the PC app keeps its own copy of
 * this module; nothing is shared across the two apps from here.
 */

import { ApiError } from "@toby/contract";

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayLocal(): string {
  return toLocalIso(new Date());
}

/** Cents are the wire format; the page shows decimal yuan. */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
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
      case "TRANSACTION_NOT_FOUND":
        return "账目不存在,可能已被删除";
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
