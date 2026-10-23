/**
 * The ledger entry draft shape, defined exactly once (docs/decisions/
 * ai-pi-runtime.md): this TypeBox schema is both the model-facing tool
 * contract (submit_entries parameters) and the server's shape gate — the
 * two can never drift. It constrains shape only: amounts still resolve to
 * integer cents and dates still pass real calendar checks in validation.ts,
 * which remains the trust boundary.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

/** Field bounds and patterns live here once; validation.ts imports them. */
const MAX_CATEGORY_LENGTH = 24;
const MAX_ACCOUNT_LENGTH = 24;
const MAX_NOTE_LENGTH = 200;

/** Non-negative decimal string with at most two decimals ("25", "25.5"). */
export const AMOUNT_PATTERN = "^[0-9]+(\\.[0-9]{1,2})?$";
/**
 * Digit shape of a date; real-calendar checks live in validation.ts. The
 * capture groups feed validation's year/month/day parsing (JSON Schema
 * matching ignores capture groups; they exist only for validation.ts.
 */
export const DATE_PATTERN = "^(\\d{4})-(\\d{2})-(\\d{2})$";

/** A proposal carries at most 10 entries (the AI path submits batches). */
export const MAX_ENTRIES_PER_PROPOSAL = 10;

export const LEDGER_ENTRY_DRAFT_SCHEMA = Type.Object(
  {
    date: Type.String({
      pattern: DATE_PATTERN,
      description: 'Entry date, "YYYY-MM-DD"',
    }),
    type: StringEnum(["expense", "income"], {
      description: "expense or income",
    }),
    category: Type.String({
      minLength: 1,
      maxLength: MAX_CATEGORY_LENGTH,
      description: `Category, at most ${MAX_CATEGORY_LENGTH} characters`,
    }),
    // Null and omitted both settle on the default account in validation.ts.
    account: Type.Optional(
      Type.Union(
        [Type.String({ maxLength: MAX_ACCOUNT_LENGTH }), Type.Null()],
        {
          description: "Account; omit when the sentence does not name one",
        },
      ),
    ),
    amount: Type.Union(
      [Type.String({ pattern: AMOUNT_PATTERN }), Type.Number({ minimum: 0 })],
      {
        description:
          "Non-negative amount with at most two decimals, as a string",
      },
    ),
    note: Type.Optional(
      Type.String({
        maxLength: MAX_NOTE_LENGTH,
        description: "Free-text note; keep the user's own words",
      }),
    ),
  },
  { additionalProperties: false },
);

export type LedgerEntryDraft = Static<typeof LEDGER_ENTRY_DRAFT_SCHEMA>;

/** Tool payload for submit_entries: a bounded batch of drafts. */
export const LEDGER_ENTRIES_TOOL_SCHEMA = Type.Object(
  {
    entries: Type.Array(LEDGER_ENTRY_DRAFT_SCHEMA, {
      minItems: 1,
      maxItems: MAX_ENTRIES_PER_PROPOSAL,
    }),
  },
  { additionalProperties: false },
);
