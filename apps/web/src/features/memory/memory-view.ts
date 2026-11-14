/**
 * Memory view helpers shared by the chat cards and the raw page: the
 * receipt shape guard and plain Chinese error copy keyed by the domain's
 * closed error-code union.
 */

import { ApiError } from "@toby/contract";
import type { MemoryReceipt } from "@toby/contract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMemoryReceipt(value: unknown): value is MemoryReceipt {
  if (!isRecord(value)) return false;
  return (
    (value.action === "remembered" ||
      value.action === "updated" ||
      value.action === "forgot") &&
    typeof value.section === "string" &&
    value.section !== "" &&
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
        return "记忆文件损坏，请手工修复 MEMORY.md，或「重置」清空重来";
      case "LIMIT_REACHED":
        return "记忆满了，该忘点什么？";
      default:
        return error.message;
    }
  }
  return "请求失败，请稍后重试";
}
