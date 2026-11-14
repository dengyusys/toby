/**
 * Memory domain client: typed access to the page reads, the receipt-backed
 * writes and the off-record toggle. Mirrors the server's response shapes —
 * receipt before/after are the rendered file lines (`- text (至 date)` /
 * `- name: text`). Every failure throws ApiError whose `code` is one of
 * MemoryErrorCode.
 */

import { ApiError, endpoint, requestJson } from "./request-json.ts";

export type MemoryType = "约定" | "关于我" | "人物";

/** The closed error-code union, mirroring the server domain's. */
export type MemoryErrorCode =
  | "INVALID_ENTRY"
  | "ENTRY_NOT_FOUND"
  | "AMBIGUOUS_ENTRY"
  | "DUPLICATE_ENTRY"
  | "MEMORY_FILE_INVALID"
  | "LIMIT_REACHED";

export interface MemoryEntry {
  type: MemoryType;
  text: string;
  /** 人物 only: the leading name before the colon. */
  name?: string;
  /** Expiry, "YYYY-MM-DD"; expired entries appear nowhere. */
  until?: string;
}

/** An entry as the page sees it: expiry resolved against today. */
export interface MemoryEntryView extends MemoryEntry {
  expired: boolean;
}

/** The receipt of one landed change — what changed, before and after. */
export interface MemoryReceipt {
  action: "remembered" | "updated" | "forgot";
  type: MemoryType;
  before?: string;
  after?: string;
  created_at: string;
}

/** The wire state of the off-record toggle. */
export interface MemoryOffRecordState {
  on: boolean;
}

export interface MemoryRememberInput {
  type: MemoryType;
  text: string;
  /** 人物 only. */
  name?: string;
  until?: string;
  /** Keyword of the one non-expired entry to replace; omitted = append. */
  replaceKeyword?: string;
}

export interface MemoryClient {
  /** Every entry, 约定 → 关于我 → 人物, expiry resolved. */
  list(): Promise<{ entries: MemoryEntryView[] }>;
  /** Append (or replace-keyword update) one entry; returns its receipt. */
  remember(input: MemoryRememberInput): Promise<MemoryReceipt>;
  /** Exact-line replace/delete — the page's veto buttons. */
  replaceExact(
    current: MemoryEntry,
    next: MemoryEntry | null,
  ): Promise<MemoryReceipt>;
  /** Delete the one keyword hit; zero hits answer 404. */
  forget(keyword: string): Promise<MemoryReceipt>;
  /** The on-demand .md snapshot (text/markdown), never stored server-side. */
  exportMarkdown(): Promise<string>;
  getOffRecord(): Promise<MemoryOffRecordState>;
  setOffRecord(on: boolean): Promise<MemoryOffRecordState>;
}

/** The export route answers markdown text, not JSON — decode errors the
 * same way requestJson does, then read the body as text. */
async function requestText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `request failed with status ${response.status}`;
    try {
      const parsed = (await response.json()) as { message?: unknown };
      if (typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      // Not JSON — keep the generic message.
    }
    throw new ApiError(response.status, "HTTP_ERROR", message);
  }
  return response.text();
}

export function createMemoryClient(baseUrl: string): MemoryClient {
  return {
    list: () =>
      requestJson<{ entries: MemoryEntryView[] }>(
        endpoint(baseUrl, "/api/memory"),
      ),
    remember: (input) =>
      requestJson<MemoryReceipt>(endpoint(baseUrl, "/api/memory/entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    replaceExact: (current, next) =>
      requestJson<MemoryReceipt>(
        endpoint(baseUrl, "/api/memory/entry/replace"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current, next }),
        },
      ),
    forget: (keyword) =>
      requestJson<MemoryReceipt>(
        endpoint(baseUrl, "/api/memory/entry/forget"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword }),
        },
      ),
    exportMarkdown: () => requestText(endpoint(baseUrl, "/api/memory/export")),
    getOffRecord: () =>
      requestJson<MemoryOffRecordState>(
        endpoint(baseUrl, "/api/memory/off-record"),
      ),
    setOffRecord: (on) =>
      requestJson<MemoryOffRecordState>(
        endpoint(baseUrl, "/api/memory/off-record"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on }),
        },
      ),
  };
}
