/**
 * The ledger wire shapes, defined once: the entry draft (the model-facing
 * tool contract and the server's shape gate can never drift) and the
 * proposal request envelope. Shape only — semantic checks live in
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

/** A proposal carries at most 10 entries (the AI path submits batches). */
export const MAX_ENTRIES_PER_PROPOSAL = 10;

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
      .max(MAX_ENTRIES_PER_PROPOSAL),
  })
  .strict();

export type LedgerEntriesToolArgs = z.infer<typeof LEDGER_ENTRIES_TOOL_SCHEMA>;

/**
 * POST /api/ledger/proposals body: one of the two intake paths. Only the
 * envelope is checked at the route — `validation.ts` checks an entry against
 * the same schema the tool hands the model.
 */

/** A value that must be present; the domain decides what it may be. */
const present = z.custom<unknown>((value) => value !== undefined);

export const PROPOSAL_BODY_SCHEMA = z.union(
  [
    z.object({ text: z.string() }).strict(),
    z.object({ entry: present }).strict(),
  ],
  { error: 'body must carry exactly one of "text" or "entry"' },
);

export type ProposalBody = z.infer<typeof PROPOSAL_BODY_SCHEMA>;
