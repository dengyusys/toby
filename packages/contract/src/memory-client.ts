/**
 * Memory domain client: typed access to the read-only page surface — the
 * raw MEMORY.md read, the off-record toggle, and the human maintenance
 * reset. Mirrors the server's response shapes — the receipt type is kept
 * for the chat card sidecar, which renders receipts that ride on other
 * payloads. Every failure throws ApiError whose `code` is one of
 * MemoryErrorCode.
 */

import { endpoint, requestJson, requestText } from "./request-json.ts";

/** The closed error-code union, mirroring the server domain's. */
export type MemoryErrorCode =
  | "INVALID_ENTRY"
  | "ENTRY_NOT_FOUND"
  | "AMBIGUOUS_ENTRY"
  | "DUPLICATE_ENTRY"
  | "MEMORY_FILE_INVALID"
  | "LIMIT_REACHED";

/** The receipt of one landed change — what changed, before and after. */
export interface MemoryReceipt {
  action: "remembered" | "updated" | "forgot";
  section: string;
  before?: string;
  after?: string;
  created_at: string;
}

/** The wire state of the off-record toggle. */
export interface MemoryOffRecordState {
  on: boolean;
}

export interface MemoryClient {
  /** The page's raw view of MEMORY.md: the file's exact bytes
   * (text/markdown) from GET /api/memory/file. */
  readFile(): Promise<string>;
  /** Discard the whole book — one atomic replace with an empty file.
   * Works on a corrupt file too (the documented recovery path). */
  reset(): Promise<{ reset_at: string }>;
  getOffRecord(): Promise<MemoryOffRecordState>;
  setOffRecord(on: boolean): Promise<MemoryOffRecordState>;
}

export function createMemoryClient(baseUrl: string): MemoryClient {
  return {
    readFile: () => requestText(endpoint(baseUrl, "/api/memory/file")),
    reset: () =>
      requestJson<{ reset_at: string }>(
        endpoint(baseUrl, "/api/memory/reset"),
        {
          method: "POST",
        },
      ),
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
