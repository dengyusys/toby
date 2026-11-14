/**
 * The memory wire shapes for the routes, defined once. Shape only — the
 * semantic rules (real calendar dates, single-line text, 人物 name rules)
 * live in parser.ts, exactly like the ledger's schema/validation split.
 */

import { z } from "zod";

/** Field shapes shared by the write bodies. */
const MEMORY_ENTRY_FIELDS = {
  type: z
    .enum(["约定", "关于我", "人物"])
    .describe("memory type: 约定, 关于我 or 人物"),
  text: z.string().min(1).describe("the entry text, one sentence"),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("人物 only: the person's name before the colon"),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      'expiry date, "YYYY-MM-DD"; real calendars checked by the domain',
    ),
};

/** POST /api/memory/entries body: one entry to remember. */
export const MEMORY_ENTRY_BODY_SCHEMA = z
  .object({
    ...MEMORY_ENTRY_FIELDS,
    replaceKeyword: z
      .string()
      .min(1)
      .optional()
      .describe("keyword of the one entry to replace; omitted = pure append"),
  })
  .strict();

export type MemoryEntryBody = z.infer<typeof MEMORY_ENTRY_BODY_SCHEMA>;

/** One exact entry — the locate half of the page's veto buttons. */
export const MEMORY_EXACT_ENTRY_SCHEMA = z.object(MEMORY_ENTRY_FIELDS).strict();

export type MemoryExactEntry = z.infer<typeof MEMORY_EXACT_ENTRY_SCHEMA>;

/** POST /api/memory/entry/replace body: locate one line, replace or delete. */
export const MEMORY_REPLACE_BODY_SCHEMA = z
  .object({
    current: MEMORY_EXACT_ENTRY_SCHEMA,
    next: MEMORY_EXACT_ENTRY_SCHEMA.nullable(),
  })
  .strict();

export type MemoryReplaceBody = z.infer<typeof MEMORY_REPLACE_BODY_SCHEMA>;

/** POST /api/memory/entry/forget body: one keyword over names and texts. */
export const MEMORY_FORGET_BODY_SCHEMA = z
  .object({
    keyword: z.string().min(1),
  })
  .strict();

export type MemoryForgetBody = z.infer<typeof MEMORY_FORGET_BODY_SCHEMA>;

/** POST /api/memory/off-record body: the page toggle. */
export const MEMORY_OFF_RECORD_BODY_SCHEMA = z
  .object({
    on: z.boolean(),
  })
  .strict();

export type MemoryOffRecordBody = z.infer<typeof MEMORY_OFF_RECORD_BODY_SCHEMA>;
