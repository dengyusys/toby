/**
 * The ledger wire shapes, defined once: the entry draft (the model-facing
 * tool contract and the server's shape gate can never drift) and the
 * write request envelope. Shape only — semantic checks live in
 * validation.ts.
 */

import { z } from "zod";

/** Field bounds and patterns live here once; validation.ts imports them. */
const MAX_CATEGORY_LENGTH = 24;
const MAX_ACCOUNT_LENGTH = 24;
const MAX_NOTE_LENGTH = 200;

/** Non-negative decimal string with at most two decimals ("25", "25.5"). */
export const AMOUNT_PATTERN = "^[0-9]+(\\.[0-9]{1,2})?$";
/**
 * Date digits only; real-calendar checks live in validation.ts. The capture
 * groups feed validation's parsing.
 */
export const DATE_PATTERN = "^(\\d{4})-(\\d{2})-(\\d{2})$";

/** One write carries at most 10 entries (the AI path submits batches). */
export const MAX_ENTRIES_PER_WRITE = 10;

export const LEDGER_ENTRY_DRAFT_SCHEMA = z
  .object({
    date: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .describe('Entry date, "YYYY-MM-DD"'),
    type: z.enum(["expense", "income"]).describe("expense or income"),
    category: z
      .string()
      .min(1)
      .max(MAX_CATEGORY_LENGTH)
      .describe(`Category, at most ${MAX_CATEGORY_LENGTH} characters`),
    // Null and omitted both settle on the default account in validation.ts.
    account: z
      .union([z.string().max(MAX_ACCOUNT_LENGTH), z.null()])
      .optional()
      .describe("Account; omit when the sentence does not name one"),
    amount: z
      .union([z.string().regex(new RegExp(AMOUNT_PATTERN)), z.number().min(0)])
      .describe("Non-negative amount with at most two decimals, as a string"),
    note: z
      .string()
      .max(MAX_NOTE_LENGTH)
      .optional()
      .describe(
        "Free-text note; usually omit — never copy the user's sentence into it",
      ),
  })
  .strict();

export type LedgerEntryDraft = z.infer<typeof LEDGER_ENTRY_DRAFT_SCHEMA>;

/** Tool payload for submit_entries: a bounded batch of drafts. */
export const LEDGER_ENTRIES_TOOL_SCHEMA = z
  .object({
    entries: z
      .array(LEDGER_ENTRY_DRAFT_SCHEMA)
      .min(1)
      .max(MAX_ENTRIES_PER_WRITE),
  })
  .strict();

export type LedgerEntriesToolArgs = z.infer<typeof LEDGER_ENTRIES_TOOL_SCHEMA>;

/**
 * A partial entry update — the PATCH body and the edit tool's patch
 * payload share this one definition, so the two paths can never drift.
 * Every field is optional; "at least one field" and all semantic checks
 * live in validation.ts, exactly like the draft's.
 */
export const LEDGER_ENTRY_PATCH_SCHEMA = z
  .object({
    date: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .optional()
      .describe('New entry date, "YYYY-MM-DD"'),
    type: z
      .enum(["expense", "income"])
      .optional()
      .describe("New direction: expense or income"),
    category: z
      .string()
      .min(1)
      .max(MAX_CATEGORY_LENGTH)
      .optional()
      .describe(`New category, at most ${MAX_CATEGORY_LENGTH} characters`),
    // Null, "", and omission are distinct here: omitted stays unchanged,
    // null/"" resets the account to the default in validation.ts.
    account: z
      .union([z.string().max(MAX_ACCOUNT_LENGTH), z.null()])
      .optional()
      .describe("New account; null resets it to the default"),
    amount: z
      .union([z.string().regex(new RegExp(AMOUNT_PATTERN)), z.number().min(0)])
      .optional()
      .describe(
        "New non-negative amount with at most two decimals, as a string",
      ),
    note: z
      .string()
      .max(MAX_NOTE_LENGTH)
      .optional()
      .describe("New free-text note; an empty string clears it"),
  })
  .strict();

export type LedgerEntryPatchDraft = z.infer<typeof LEDGER_ENTRY_PATCH_SCHEMA>;

/**
 * The edit tool's match: how to locate the one stored transaction the
 * sentence is correcting — deterministic criteria the server resolves,
 * never a row id. At least one criterion is enforced in validation.ts;
 * an omitted date resolves to today in the service.
 */
export const LEDGER_EDIT_MATCH_SCHEMA = z
  .object({
    date: z
      .string()
      .regex(new RegExp(DATE_PATTERN))
      .optional()
      .describe('The recorded entry date, "YYYY-MM-DD"; omit to search today'),
    type: z
      .enum(["expense", "income"])
      .optional()
      .describe("Direction to narrow the candidates by"),
    category: z
      .string()
      .min(1)
      .max(MAX_CATEGORY_LENGTH)
      .optional()
      .describe("Exact category to narrow the candidates by"),
    note_contains: z
      .string()
      .min(1)
      .max(MAX_NOTE_LENGTH)
      .optional()
      .describe("Note substring to narrow the candidates by"),
  })
  .strict();

export type LedgerEditMatchDraft = z.infer<typeof LEDGER_EDIT_MATCH_SCHEMA>;

/** Tool payload for submit_edit: locate one row, patch its fields. */
export const LEDGER_EDIT_TOOL_SCHEMA = z
  .object({
    match: LEDGER_EDIT_MATCH_SCHEMA,
    patch: LEDGER_ENTRY_PATCH_SCHEMA,
  })
  .strict();

export type LedgerEditToolArgs = z.infer<typeof LEDGER_EDIT_TOOL_SCHEMA>;

/**
 * POST /api/ledger/entries body: one of the two intake paths. Only the
 * envelope is checked at the route — `validation.ts` checks an entry against
 * the same schema the tool hands the model.
 */

/** A value that must be present; the domain decides what it may be. */
const present = z.custom<unknown>((value) => value !== undefined);

export const ENTRY_BODY_SCHEMA = z.union(
  [
    z.object({ text: z.string() }).strict(),
    z.object({ entry: present }).strict(),
  ],
  { error: 'body must carry exactly one of "text" or "entry"' },
);

export type EntryBody = z.infer<typeof ENTRY_BODY_SCHEMA>;
