/**
 * Schedule domain client: typed access to the daily status board —
 * tracked items with ordered status vocabularies, one entry per item
 * per local calendar date, and saved views. Mirrors the server's
 * response shapes — dates are plain "YYYY-MM-DD" strings with no
 * timezone conversion anywhere. Every failure throws ApiError whose
 * `code` is one of ScheduleErrorCode.
 */

import { endpoint, requestJson } from "./request-json.ts";

/** The closed error-code union, mirroring the server domain's. */
export type ScheduleErrorCode =
  | "SCHEDULE_ITEM_NOT_FOUND"
  | "SCHEDULE_ENTRY_NOT_FOUND"
  | "SCHEDULE_VIEW_NOT_FOUND"
  | "SCHEDULE_ITEM_DUPLICATE"
  | "SCHEDULE_STATUS_IN_USE"
  | "SCHEDULE_INVALID_ITEM"
  | "SCHEDULE_INVALID_DATE"
  | "SCHEDULE_INVALID_STATUS"
  | "SCHEDULE_INVALID_VIEW_CONFIG";

/** One tracked item: a unique title plus its ordered status vocabulary. */
export interface ScheduleItem {
  title: string;
  /** Ordered statuses, best → worst by convention. */
  statuses: string[];
}

/** A stored item: identity added; listing order is creation order. */
export interface ScheduleItemRow extends ScheduleItem {
  id: number;
  /** The item's total entries across ALL dates (delete-button counts). */
  entryCount: number;
}

/** A partial item update: present fields change, absent fields stay. */
export interface ScheduleItemPatch {
  title?: string;
  statuses?: string[];
}

/** One stored entry joined with its item's title, as the range list returns it. */
export interface ScheduleEntryView {
  id: number;
  itemId: number;
  title: string;
  /** Plain local calendar date, "YYYY-MM-DD". */
  date: string;
  status: string;
  updatedAt: string;
}

/** The PUT /entries response: the full landed row plus created. */
export interface ScheduleEntryPutResult extends ScheduleEntryView {
  created: boolean;
}

/** Result of a user-initiated delete. */
export interface ScheduleDeleteResult {
  id: number;
  action: "deleted";
  deletedAt: string;
}

export type ScheduleViewType = "calendar" | "list";

/** A saved view's query: the closed config shape. */
export interface ScheduleViewConfig {
  /** Item ids as decimal strings. */
  itemIds?: string[];
  /** Vocabulary strings to narrow the board by. */
  statuses?: string[];
  sort: "date" | "title";
  group: "none" | "item" | "status";
}

/** A saved view: a named query the board renders. */
export interface ScheduleView {
  id: number;
  name: string;
  type: ScheduleViewType;
  config: ScheduleViewConfig;
}

/** A partial view update: present fields change, absent fields stay. */
export interface ScheduleViewPatch {
  name?: string;
  type?: ScheduleViewType;
  config?: ScheduleViewConfig;
}

export interface ScheduleClient {
  /** Items in creation order. */
  listItems(): Promise<ScheduleItemRow[]>;
  /** Register one item; a duplicate title answers SCHEDULE_ITEM_DUPLICATE. */
  createItem(item: ScheduleItem): Promise<ScheduleItemRow>;
  /** Patch title and/or statuses; unknown ids 404. */
  updateItem(id: number, patch: ScheduleItemPatch): Promise<ScheduleItemRow>;
  /**
   * Delete one item; its entries cascade in the same write and the
   * response reports how many went with it.
   */
  deleteItem(id: number): Promise<{ deletedEntries: number }>;
  /**
   * Create-or-update one entry by its natural key (itemId, date);
   * idempotent — the same payload twice lands one row, second call
   * answers created: false. Last write wins; the full landed row is
   * the answer either way.
   */
  putEntry(entry: {
    itemId: number;
    date: string;
    status: string;
  }): Promise<ScheduleEntryPutResult>;
  /** Delete one stored entry by id; unknown ids 404. */
  deleteEntry(id: number): Promise<ScheduleDeleteResult>;
  /** Entries with from <= date <= to (inclusive), flat, joined titles. */
  listEntries(
    from: string,
    to: string,
  ): Promise<{ from: string; to: string; entries: ScheduleEntryView[] }>;
  /** Saved views in creation order. */
  listViews(): Promise<ScheduleView[]>;
  createView(view: Omit<ScheduleView, "id">): Promise<ScheduleView>;
  /** Patch a saved view; unknown ids 404. */
  updateView(id: number, patch: ScheduleViewPatch): Promise<ScheduleView>;
  /** Delete one saved view by id; unknown ids 404. */
  deleteView(id: number): Promise<ScheduleDeleteResult>;
}

export function createScheduleClient(baseUrl: string): ScheduleClient {
  return {
    listItems: async () => {
      const body = await requestJson<{ items: ScheduleItemRow[] }>(
        endpoint(baseUrl, "/api/schedule/items"),
      );
      return body.items;
    },
    createItem: (item) =>
      requestJson<ScheduleItemRow>(endpoint(baseUrl, "/api/schedule/items"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      }),
    updateItem: (id, patch) =>
      requestJson<ScheduleItemRow>(
        endpoint(baseUrl, `/api/schedule/items/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      ),
    deleteItem: (id) =>
      requestJson<{ deletedEntries: number }>(
        endpoint(baseUrl, `/api/schedule/items/${id}`),
        { method: "DELETE" },
      ),
    putEntry: (entry) =>
      requestJson<ScheduleEntryPutResult>(
        endpoint(baseUrl, "/api/schedule/entries"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        },
      ),
    deleteEntry: (id) =>
      requestJson<ScheduleDeleteResult>(
        endpoint(baseUrl, `/api/schedule/entries/${id}`),
        { method: "DELETE" },
      ),
    listEntries: (from, to) =>
      requestJson<{
        from: string;
        to: string;
        entries: ScheduleEntryView[];
      }>(
        endpoint(
          baseUrl,
          `/api/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        ),
      ),
    listViews: async () => {
      const body = await requestJson<{ views: ScheduleView[] }>(
        endpoint(baseUrl, "/api/schedule/views"),
      );
      return body.views;
    },
    createView: (view) =>
      requestJson<ScheduleView>(endpoint(baseUrl, "/api/schedule/views"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(view),
      }),
    updateView: (id, patch) =>
      requestJson<ScheduleView>(
        endpoint(baseUrl, `/api/schedule/views/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      ),
    deleteView: (id) =>
      requestJson<ScheduleDeleteResult>(
        endpoint(baseUrl, `/api/schedule/views/${id}`),
        { method: "DELETE" },
      ),
  };
}
