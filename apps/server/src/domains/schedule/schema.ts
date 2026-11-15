/**
 * The schedule wire shapes, defined once. validation.ts is the trust
 * boundary: the write routes only check "is this a JSON object with the
 * expected keys" (so every payload problem surfaces as the resource's
 * own domain code, never a generic one), and everything else — shape
 * and semantics — is checked there against these schemas.
 */

import { z } from "zod";

/** Field bounds live here once; validation.ts imports them. */
export const MAX_TITLE_LENGTH = 50;
/**
 * Date digits only; real-calendar checks live in validation.ts. Shared
 * by the wire envelopes and the AI tools' payloads, so the two can
 * never drift.
 */
export const DATE_PATTERN = "^(\\d{4})-(\\d{2})-(\\d{2})$";
export const MAX_STATUS_LENGTH = 30;
/** An item's status vocabulary: 1..8 ordered entries, best → worst. */
export const MIN_STATUSES = 1;
export const MAX_STATUSES = 8;
export const MAX_VIEW_NAME_LENGTH = 60;
export const MAX_VIEW_ITEM_IDS = 32;
export const MAX_VIEW_STATUSES = MAX_STATUSES;
/**
 * The range list's window cap: from and to are inclusive and may span
 * at most 366 days — a wider window answers SCHEDULE_INVALID_DATE.
 */
export const MAX_RANGE_SPAN_DAYS = 366;

/**
 * The write-route envelope: the expected keys, nothing more about their
 * values. Unknown keys and non-object bodies answer BAD_REQUEST here;
 * presence, types and semantics are validation.ts's call, answered with
 * the resource's own closed error code. Every key is explicitly
 * optional so a missing key reaches the domain instead of dying here.
 */
export const ITEM_BODY_SCHEMA = z
  .object({
    title: z.unknown().optional(),
    statuses: z.unknown().optional(),
  })
  .strict();

export const ITEM_PATCH_SCHEMA = z
  .object({
    title: z.unknown().optional(),
    statuses: z.unknown().optional(),
  })
  .strict();

export const ENTRY_PUT_SCHEMA = z
  .object({
    itemId: z.unknown().optional(),
    date: z.unknown().optional(),
    status: z.unknown().optional(),
  })
  .strict();

/**
 * The AI tools' payloads (extraction.ts) and the model-facing contract:
 * shape only — the real-calendar date, the trimmed status bounds and
 * the vocabulary membership all live in validation.ts, the same gate
 * the HTTP write path uses.
 */
export const SCHEDULE_ITEMS_TOOL_SCHEMA = z.object({}).strict();

export const SCHEDULE_ENTRIES_TOOL_SCHEMA = z
  .object({
    from: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .describe('Range start, "YYYY-MM-DD", inclusive'),
    to: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .describe('Range end, "YYYY-MM-DD", inclusive'),
  })
  .strict();

export const SCHEDULE_PUT_TOOL_SCHEMA = z
  .object({
    itemId: z
      .number()
      .int()
      .min(1)
      .describe("The item's id, from the item list"),
    date: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .describe('Entry date, "YYYY-MM-DD"'),
    status: z
      .string()
      .min(1)
      .max(MAX_STATUS_LENGTH)
      .describe("One of that item's own status words, verbatim"),
  })
  .strict();

export const SCHEDULE_CLEAR_TOOL_SCHEMA = z
  .object({
    itemId: z
      .number()
      .int()
      .min(1)
      .describe("The item's id, from the item list"),
    date: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .describe('Entry date, "YYYY-MM-DD"'),
  })
  .strict();

export const VIEW_BODY_SCHEMA = z
  .object({
    name: z.unknown().optional(),
    type: z.unknown().optional(),
    config: z.unknown().optional(),
  })
  .strict();

export const VIEW_PATCH_SCHEMA = z
  .object({
    name: z.unknown().optional(),
    type: z.unknown().optional(),
    config: z.unknown().optional(),
  })
  .strict();

/**
 * A saved view's config: the closed shape. Unknown fields are rejected
 * by `.strict()`; `sort` and `group` are required enums, the list fields
 * optional.
 */
export const VIEW_CONFIG_SCHEMA = z
  .object({
    itemIds: z
      .array(z.string().min(1).max(16))
      .max(MAX_VIEW_ITEM_IDS)
      .optional(),
    statuses: z
      .array(z.string().min(1).max(MAX_STATUS_LENGTH))
      .max(MAX_VIEW_STATUSES)
      .optional(),
    sort: z.enum(["date", "title"]),
    group: z.enum(["none", "item", "status"]),
  })
  .strict();

export type ViewConfigDraft = z.infer<typeof VIEW_CONFIG_SCHEMA>;
