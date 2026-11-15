/**
 * Schedule domain types: the pure vocabulary shared by validation, the
 * repository and the routes. It is a daily status board: tracked items
 * own an ordered status vocabulary (convention best → worst), entries
 * record one item's status per local calendar date. Dates are plain
 * "YYYY-MM-DD" strings — no timezone conversion anywhere. Response
 * shapes are mirrored by hand in packages/contract/src/schedule-client.ts
 * — change both sides together.
 */

/** One tracked item: a unique title plus its ordered status vocabulary. */
export interface ScheduleItem {
  readonly title: string;
  /**
   * Ordered statuses, best → worst by convention ("是"/"否",
   * "完成"/"部分"/"没做"). Order is exactly as given.
   */
  readonly statuses: readonly string[];
}

/** A stored item: identity added; listing order is creation order (by id). */
export interface ScheduleItemRow extends ScheduleItem {
  readonly id: number;
  /** The item's total entries across ALL dates (delete-button counts). */
  readonly entryCount: number;
}

/** A partial item update: present fields change, absent fields stay. */
export interface ScheduleItemPatch {
  readonly title?: string;
  readonly statuses?: readonly string[];
}

/**
 * The body of PUT /api/schedule/entries: create-or-update one entry by
 * its natural key (itemId, date).
 */
export interface ScheduleEntryPut {
  readonly itemId: number;
  readonly date: string;
  readonly status: string;
}

/**
 * One stored entry joined with its item's title, as the range list and
 * the PUT response return it. No versioning: last write wins, so PUT
 * answers the full landed row plus whether it created the pair.
 */
export interface ScheduleEntryView {
  readonly id: number;
  readonly itemId: number;
  readonly title: string;
  readonly date: string;
  readonly status: string;
  readonly updatedAt: string;
}

/** The PUT /entries response: the full landed row plus created. */
export interface ScheduleEntryPutResult extends ScheduleEntryView {
  readonly created: boolean;
}

/** Result of a user-initiated entry delete. */
export interface ScheduleDeleteResult {
  readonly id: number;
  readonly action: "deleted";
  readonly deletedAt: string;
}

/** One entry removed by an AI write turn's clear op. */
export interface ScheduleClearedEntry {
  readonly id: number;
  readonly itemId: number;
  readonly title: string;
  readonly date: string;
}

/**
 * The receipt of one AI write turn: every landed put (full row plus
 * whether it created the pair) and every entry the turn's clear ops
 * actually removed. Each op is its own validated, transactional
 * repository write; there is no revert window — recovery is writing
 * again or backup. `memoryReceipts` rides only when the run also wrote
 * memory (silent learning); opaque passthrough, rendered by the memory
 * card path, never read by the schedule.
 */
export interface ScheduleWriteReceipt {
  readonly written: number;
  readonly entries: readonly ScheduleEntryPutResult[];
  readonly cleared: readonly ScheduleClearedEntry[];
  readonly createdAt: string;
  readonly memoryReceipts?: readonly unknown[];
}

export type ScheduleViewType = "calendar" | "list";

/**
 * A saved view's query, validated against this closed shape — never
 * arbitrary JSON. `itemIds` are item ids as decimal strings; `statuses`
 * are vocabulary strings; `sort` and `group` are required enums.
 */
export interface ScheduleViewConfig {
  readonly itemIds?: readonly string[];
  readonly statuses?: readonly string[];
  readonly sort: "date" | "title";
  readonly group: "none" | "item" | "status";
}

/** A saved view: a named query the board renders. */
export interface ScheduleView {
  readonly id: number;
  readonly name: string;
  readonly type: ScheduleViewType;
  readonly config: ScheduleViewConfig;
}

/** A partial view update: present fields change, absent fields stay. */
export interface ScheduleViewPatch {
  readonly name?: string;
  readonly type?: ScheduleViewType;
  readonly config?: ScheduleViewConfig;
}
