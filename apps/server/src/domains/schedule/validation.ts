/**
 * Deterministic schedule validation and normalization — the trust
 * boundary. Everything that enters the domain passes through here:
 * untrusted input in, a fully normalized storable shape out, or a
 * rejected request with zero writes. Dates are real local calendar
 * dates ("YYYY-MM-DD", leap years included) with no timezone
 * conversion anywhere; a status is only a bounded string until the
 * service checks it against the referenced item's current vocabulary.
 */

import type { ZodType } from "zod";
import {
  DATE_PATTERN,
  ENTRY_PUT_SCHEMA,
  ITEM_BODY_SCHEMA,
  ITEM_PATCH_SCHEMA,
  MAX_STATUSES,
  MAX_STATUS_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_VIEW_NAME_LENGTH,
  MAX_RANGE_SPAN_DAYS,
  MIN_STATUSES,
  VIEW_BODY_SCHEMA,
  VIEW_CONFIG_SCHEMA,
  VIEW_PATCH_SCHEMA,
  type ViewConfigDraft,
} from "./schema.ts";
import type {
  ScheduleEntryPut,
  ScheduleItem,
  ScheduleItemPatch,
  ScheduleView,
  ScheduleViewConfig,
  ScheduleViewPatch,
  ScheduleViewType,
} from "./types.ts";
import { ScheduleInputError, type ScheduleErrorCode } from "./errors.ts";

export { ScheduleInputError } from "./errors.ts";

function inputError(
  code: ScheduleErrorCode,
  message: string,
): ScheduleInputError {
  return new ScheduleInputError(code, message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape gate: the given schema, with the first violation reported. */
function requireShape<T>(
  raw: unknown,
  schema: ZodType<T>,
  label: string,
  code: ScheduleErrorCode,
): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    const where = first?.path.length ? ` at "${first.path.join(".")}"` : "";
    throw inputError(
      code,
      `${label} violates the schema${where}: ${first?.message ?? "unknown mismatch"}`,
    );
  }
  return parsed.data;
}

/**
 * Local "YYYY-MM-DD" with real calendar checking (month range, month
 * length, leap years). Any past or future date is valid — backfilling
 * is a first-class flow. Never a timezone conversion: the string is
 * the date.
 */
export function parseScheduleDate(value: unknown, field = "date"): string {
  if (typeof value !== "string") {
    throw inputError(
      "SCHEDULE_INVALID_DATE",
      `${field} must be a "YYYY-MM-DD" string`,
    );
  }
  const match = new RegExp(DATE_PATTERN).exec(value.trim());
  if (match === null) {
    throw inputError(
      "SCHEDULE_INVALID_DATE",
      `${field} must be a "YYYY-MM-DD" string`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthLengths[month - 1] ?? 0)
  ) {
    throw inputError(
      "SCHEDULE_INVALID_DATE",
      `${field} is not a real calendar date: ${value.trim()}`,
    );
  }
  return value.trim();
}

/**
 * The inclusive range-window rule, shared by the HTTP list and the AI
 * tools' read port: both ends required, from not after to, and the span
 * capped at MAX_RANGE_SPAN_DAYS days — the answer is always complete.
 */
export function resolveRange(
  fromRaw: unknown,
  toRaw: unknown,
): { from: string; to: string } {
  const from = parseScheduleDate(fromRaw, "from");
  const to = parseScheduleDate(toRaw, "to");
  if (from > to) {
    throw inputError("SCHEDULE_INVALID_DATE", "from must not be after to");
  }
  const spanDays =
    (Date.UTC(
      Number(to.slice(0, 4)),
      Number(to.slice(5, 7)) - 1,
      Number(to.slice(8, 10)),
    ) -
      Date.UTC(
        Number(from.slice(0, 4)),
        Number(from.slice(5, 7)) - 1,
        Number(from.slice(8, 10)),
      )) /
    86_400_000;
  if (spanDays > MAX_RANGE_SPAN_DAYS - 1) {
    throw inputError(
      "SCHEDULE_INVALID_DATE",
      `the range may span at most ${MAX_RANGE_SPAN_DAYS} days`,
    );
  }
  return { from, to };
}

/**
 * One status vocabulary: 1..8 trimmed non-empty unique strings (each ≤
 * MAX_STATUS_LENGTH), order preserved exactly as given (best → worst
 * convention).
 */
export function normalizeStatuses(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw inputError("SCHEDULE_INVALID_ITEM", "statuses must be a JSON array");
  }
  if (value.length < MIN_STATUSES || value.length > MAX_STATUSES) {
    throw inputError(
      "SCHEDULE_INVALID_ITEM",
      `statuses must carry ${MIN_STATUSES} to ${MAX_STATUSES} entries`,
    );
  }
  const statuses: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw inputError(
        "SCHEDULE_INVALID_ITEM",
        "every status must be a string",
      );
    }
    const status = entry.trim();
    if (status.length < 1) {
      throw inputError(
        "SCHEDULE_INVALID_ITEM",
        "statuses must not contain empty entries",
      );
    }
    if (status.length > MAX_STATUS_LENGTH) {
      throw inputError(
        "SCHEDULE_INVALID_ITEM",
        `every status must be at most ${MAX_STATUS_LENGTH} characters`,
      );
    }
    if (statuses.includes(status)) {
      throw inputError(
        "SCHEDULE_INVALID_ITEM",
        `statuses must be unique: "${status}" appears twice`,
      );
    }
    statuses.push(status);
  }
  return statuses;
}

function requireTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw inputError("SCHEDULE_INVALID_ITEM", "title must be a string");
  }
  const title = value.trim();
  if (title.length < 1) {
    throw inputError("SCHEDULE_INVALID_ITEM", "title must not be empty");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw inputError(
      "SCHEDULE_INVALID_ITEM",
      `title must be at most ${MAX_TITLE_LENGTH} characters`,
    );
  }
  return title;
}

/** Validate and normalize one tracked item into its storable form. */
export function normalizeItem(raw: unknown): ScheduleItem {
  requireShape(raw, ITEM_BODY_SCHEMA, "item", "SCHEDULE_INVALID_ITEM");
  if (!isRecord(raw)) {
    throw inputError("SCHEDULE_INVALID_ITEM", "item must be a JSON object");
  }
  if (raw.title === undefined) {
    throw inputError("SCHEDULE_INVALID_ITEM", "title is required");
  }
  if (raw.statuses === undefined) {
    throw inputError("SCHEDULE_INVALID_ITEM", "statuses is required");
  }
  return {
    title: requireTitle(raw.title),
    statuses: normalizeStatuses(raw.statuses),
  };
}

/**
 * Validate and normalize a partial item update. Every present field
 * gets the same semantics as a fresh item; an update must change
 * something — an empty patch is rejected.
 */
export function normalizeItemPatch(raw: unknown): ScheduleItemPatch {
  requireShape(raw, ITEM_PATCH_SCHEMA, "patch", "SCHEDULE_INVALID_ITEM");
  if (!isRecord(raw)) {
    throw inputError("SCHEDULE_INVALID_ITEM", "patch must be a JSON object");
  }
  const patch: { title?: string; statuses?: string[] } = {};
  if (raw.title !== undefined) {
    patch.title = requireTitle(raw.title);
  }
  if (raw.statuses !== undefined) {
    patch.statuses = normalizeStatuses(raw.statuses);
  }
  if (Object.keys(patch).length === 0) {
    throw inputError(
      "SCHEDULE_INVALID_ITEM",
      "patch must carry at least one field",
    );
  }
  return patch;
}

/**
 * Validate and normalize a PUT /entries body. Status here is only a
 * bounded non-empty string; membership in the referenced item's current
 * vocabulary is checked inside the write transaction (repository.ts),
 * so a concurrent vocabulary change cannot slip a stale status in.
 */
export function normalizeEntryPut(raw: unknown): ScheduleEntryPut {
  requireShape(raw, ENTRY_PUT_SCHEMA, "entry", "SCHEDULE_INVALID_DATE");
  if (!isRecord(raw)) {
    throw inputError("SCHEDULE_INVALID_DATE", "entry must be a JSON object");
  }
  const itemId = raw.itemId;
  if (typeof itemId !== "number" || !Number.isInteger(itemId) || itemId < 1) {
    throw inputError(
      "SCHEDULE_INVALID_ITEM",
      "itemId must be a positive integer",
    );
  }
  const date = parseScheduleDate(raw.date, "date");
  const status = raw.status;
  if (typeof status !== "string") {
    throw inputError("SCHEDULE_INVALID_STATUS", "status must be a string");
  }
  const trimmed = status.trim();
  if (trimmed.length < 1) {
    throw inputError("SCHEDULE_INVALID_STATUS", "status must not be empty");
  }
  if (trimmed.length > MAX_STATUS_LENGTH) {
    throw inputError(
      "SCHEDULE_INVALID_STATUS",
      `status must be at most ${MAX_STATUS_LENGTH} characters`,
    );
  }
  return { itemId, date, status: trimmed };
}

/**
 * Validate a saved view's config against the closed shape. `sort` and
 * `group` are required; itemIds are decimal strings of positive
 * integers (the client's item references); statuses are vocabulary
 * strings. Unknown fields are rejected — never arbitrary JSON.
 */
export function normalizeViewConfig(value: unknown): ScheduleViewConfig {
  if (!isRecord(value)) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      "config must be a JSON object",
    );
  }
  const draft = requireShape(
    value,
    VIEW_CONFIG_SCHEMA,
    "config",
    "SCHEDULE_INVALID_VIEW_CONFIG",
  ) as ViewConfigDraft;
  const config: {
    itemIds?: string[];
    statuses?: string[];
    sort: ViewConfigDraft["sort"];
    group: ViewConfigDraft["group"];
  } = { sort: draft.sort, group: draft.group };
  if (draft.itemIds !== undefined) {
    const itemIds: string[] = [];
    for (const id of draft.itemIds) {
      if (!/^[1-9][0-9]*$/.test(id)) {
        throw inputError(
          "SCHEDULE_INVALID_VIEW_CONFIG",
          `config.itemIds must be decimal strings of positive integers: "${id}"`,
        );
      }
      itemIds.push(id);
    }
    config.itemIds = itemIds;
  }
  if (draft.statuses !== undefined) {
    const statuses: string[] = [];
    for (const status of draft.statuses) {
      const trimmed = status.trim();
      if (trimmed.length < 1) {
        throw inputError(
          "SCHEDULE_INVALID_VIEW_CONFIG",
          "config.statuses must not contain empty entries",
        );
      }
      statuses.push(trimmed);
    }
    config.statuses = statuses;
  }
  return config;
}

/** A view's name, validated the same everywhere it appears. */
function requireViewName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      "name must be a non-empty string",
    );
  }
  if (value.trim().length > MAX_VIEW_NAME_LENGTH) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      `name must be at most ${MAX_VIEW_NAME_LENGTH} characters`,
    );
  }
  return value.trim();
}

/** A view's type, validated the same everywhere it appears. */
function requireViewType(value: unknown): ScheduleViewType {
  if (value !== "calendar" && value !== "list") {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      'type must be "calendar" or "list"',
    );
  }
  return value;
}

/** Validate and normalize one saved view body (name, type, config). */
export function normalizeViewBody(raw: unknown): Omit<ScheduleView, "id"> {
  requireShape(raw, VIEW_BODY_SCHEMA, "view", "SCHEDULE_INVALID_VIEW_CONFIG");
  if (!isRecord(raw)) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      "view must be a JSON object",
    );
  }
  return {
    name: requireViewName(raw.name),
    type: requireViewType(raw.type),
    config: normalizeViewConfig(raw.config),
  };
}

/**
 * Validate and normalize a partial view update. Present fields get the
 * same semantics as a fresh view; an update must change something —
 * an empty patch is rejected.
 */
export function normalizeViewPatch(raw: unknown): ScheduleViewPatch {
  requireShape(raw, VIEW_PATCH_SCHEMA, "patch", "SCHEDULE_INVALID_VIEW_CONFIG");
  if (!isRecord(raw)) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      "patch must be a JSON object",
    );
  }
  const patch: {
    name?: string;
    type?: ScheduleViewType;
    config?: ScheduleViewConfig;
  } = {};
  if (raw.name !== undefined) {
    patch.name = requireViewName(raw.name);
  }
  if (raw.type !== undefined) {
    patch.type = requireViewType(raw.type);
  }
  if (raw.config !== undefined) {
    patch.config = normalizeViewConfig(raw.config);
  }
  if (Object.keys(patch).length === 0) {
    throw inputError(
      "SCHEDULE_INVALID_VIEW_CONFIG",
      "patch must carry at least one field",
    );
  }
  return patch;
}
