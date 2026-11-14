/**
 * Memory page view helpers: exact wire entries, stable row identities and
 * plain Chinese error copy keyed by the domain's closed error-code union.
 */

import { ApiError } from "@toby/contract";
import type {
  MemoryEntry,
  MemoryEntryView,
  MemoryReceipt,
  MemoryType,
} from "@toby/contract";

/** The view-only expiry flag must not cross the strict write schema. */
export function exactEntry(entry: MemoryEntryView): MemoryEntry {
  return {
    type: entry.type,
    text: entry.text,
    ...(entry.name === undefined ? {} : { name: entry.name }),
    ...(entry.until === undefined ? {} : { until: entry.until }),
  };
}

/** Exact lines are unique by domain rule, so the line is also the row key. */
export function entryKey(entry: MemoryEntryView): string {
  return JSON.stringify(exactEntry(entry));
}

export function entryLabel(entry: MemoryEntryView): string {
  return entry.type === "人物"
    ? `${entry.name ?? ""}:${entry.text}`
    : entry.text;
}

const MEMORY_TYPES: readonly MemoryType[] = ["约定", "关于我", "人物"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMemoryReceipt(value: unknown): value is MemoryReceipt {
  if (!isRecord(value)) return false;
  return (
    (value.action === "remembered" ||
      value.action === "updated" ||
      value.action === "forgot") &&
    MEMORY_TYPES.includes(value.type as MemoryType) &&
    typeof value.created_at === "string" &&
    (value.before === undefined || typeof value.before === "string") &&
    (value.after === undefined || typeof value.after === "string")
  );
}

export function isMemoryFileInvalid(error: unknown): boolean {
  return error instanceof ApiError && error.code === "MEMORY_FILE_INVALID";
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_ENTRY":
        return "这条记忆格式不对，请检查内容和日期";
      case "ENTRY_NOT_FOUND":
        return "没有找到这条记忆，可能已被改掉或删除";
      case "AMBIGUOUS_ENTRY":
        // The server message includes the candidates needed to resolve it.
        return error.message;
      case "DUPLICATE_ENTRY":
        return "已经记住了，不用重复添加";
      case "MEMORY_FILE_INVALID":
        return "记忆文件损坏，请手工修复 MEMORY.md";
      case "LIMIT_REACHED":
        return "记忆满了，该忘点什么？";
      default:
        return error.message;
    }
  }
  return "请求失败，请稍后重试";
}
