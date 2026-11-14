/**
 * The memory wire shapes for the routes, defined once. Shape only — the
 * semantic rules (real calendar dates, single-line text, section-name
 * rules) live in parser.ts, exactly like the ledger's schema/validation
 * split. The page is a read-only raw view, so the only write body left
 * is the off-record toggle; the reset takes no body.
 */

import { z } from "zod";

/** POST /api/memory/off-record body: the page toggle. */
export const MEMORY_OFF_RECORD_BODY_SCHEMA = z
  .object({
    on: z.boolean(),
  })
  .strict();

export type MemoryOffRecordBody = z.infer<typeof MEMORY_OFF_RECORD_BODY_SCHEMA>;
