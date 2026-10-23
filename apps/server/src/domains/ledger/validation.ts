/**
 * Deterministic entry validation and normalization — the trust boundary.
 * Everything that enters the ledger — the structured path today, the AI
 * extraction agent's tool calls — passes through here: untrusted input in,
 * a fully normalized LedgerEntry out, or a rejected request with zero
 * proposals and zero writes.
 *
 * Two layers, deliberately separate (docs/decisions/ai-pi-runtime.md):
 * - shape: the shared TypeBox draft schema (same definition the
 *   submit_entries tool hands the model) rejects malformed payloads;
 * - semantics: below the shape gate, only meaning is checked — amounts
 *   parse digit-wise into integer cents, dates pass real calendar checks,
 *   blanks settle on defaults. No floating-point arithmetic ever touches
 *   money, and no model output is trusted past this file.
 */

import { Check, Errors } from "typebox/value";
import {
  AMOUNT_PATTERN,
  DATE_PATTERN,
  LEDGER_ENTRY_DRAFT_SCHEMA,
  MAX_ENTRIES_PER_PROPOSAL,
  type LedgerEntryDraft,
} from "./schema.ts";
import type { LedgerEntry } from "./types.ts";
import { LedgerInputError } from "./errors.ts";

export { LedgerInputError } from "./errors.ts";

export { MAX_ENTRIES_PER_PROPOSAL } from "./schema.ts";

/**
 * One-sentence logging rarely names an account; an omitted or blank account
 * settles on this placeholder instead of a rejection or a follow-up.
 */
export const DEFAULT_LEDGER_ACCOUNT = "未关联";

const AMOUNT_RE = new RegExp(AMOUNT_PATTERN);
const DATE_RE = new RegExp(DATE_PATTERN);

function inputError(message: string): LedgerInputError {
  return new LedgerInputError(message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Shape gate: the shared draft schema, with the first violation reported.
function requireDraftShape(raw: unknown, label: string): LedgerEntryDraft {
  if (!Check(LEDGER_ENTRY_DRAFT_SCHEMA, raw)) {
    const [first] = Errors(LEDGER_ENTRY_DRAFT_SCHEMA, raw);
    const where = first?.instancePath ? ` at "${first.instancePath}"` : "";
    throw inputError(
      `${label} violates the entry schema${where}: ${first?.message ?? "unknown mismatch"}`,
    );
  }
  return raw as LedgerEntryDraft;
}

/**
 * Non-negative amount with at most two decimals ("25", "25.5", "25.50",
 * 25.5), parsed digit-wise into integer cents. Rejects negatives, three+
 * decimals, exponent forms and anything a human did not type as money.
 * (The draft schema already bounds the shape; this is the money-semantics
 * gate and also accepts plain numbers from the structured path.)
 */
export function parseAmountToCents(value: unknown, field = "amount"): number {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : null;
  if (text === null || !AMOUNT_RE.test(text)) {
    throw inputError(
      `${field} must be a non-negative number with at most two decimals`,
    );
  }
  const [wholePart, fractionPart = ""] = text.split(".");
  // Digit-wise into cents: "25.5" → "25" + "50" → 2550.
  const cents = Number(`${wholePart}${fractionPart.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw inputError(`${field} is too large`);
  }
  return cents;
}

/**
 * Local "YYYY-MM-DD" with real calendar checking (month range, month
 * length, leap years). Any past or future year is valid — backfilling is a
 * first-class flow. The schema only pins the digit shape; real calendars
 * are checked here.
 */
export function parseEntryDate(value: unknown, field = "date"): string {
  if (typeof value !== "string") {
    throw inputError(`${field} must be a "YYYY-MM-DD" string`);
  }
  const match = DATE_RE.exec(value.trim());
  if (match === null) {
    throw inputError(`${field} must be a "YYYY-MM-DD" string`);
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
    throw inputError(`${field} is not a real calendar date: ${value.trim()}`);
  }
  return value.trim();
}

/**
 * Validate and normalize one raw entry into its storable form. Shape is
 * guaranteed by the draft schema; the checks below are semantics only:
 * real calendars, integer cents, blanks settling on defaults.
 */
export function normalizeEntry(raw: unknown): LedgerEntry {
  if (!isRecord(raw)) {
    throw inputError("entry must be a JSON object");
  }
  const draft = requireDraftShape(raw, "entry");
  // StringEnum's inferred Static is plain string, so the union narrows at
  // runtime here rather than in the type system.
  if (draft.type !== "income" && draft.type !== "expense") {
    throw inputError('type must be "income" or "expense"');
  }
  // Whitespace-only values pass the schema's minLength and are rejected here.
  const category = draft.category.trim();
  if (category.length < 1) {
    throw inputError("category must not be empty");
  }
  const note = (draft.note ?? "").trim();
  let account = DEFAULT_LEDGER_ACCOUNT;
  if (draft.account != null) {
    const trimmedAccount = draft.account.trim();
    if (trimmedAccount.length > 0) {
      account = trimmedAccount;
    }
  }
  return {
    date: parseEntryDate(draft.date),
    type: draft.type,
    category,
    account,
    amount: parseAmountToCents(draft.amount),
    note,
  };
}

/** Validate a batch (1..MAX) — the AI path lands on this. */
export function normalizeEntries(raw: unknown): LedgerEntry[] {
  if (!Array.isArray(raw)) {
    throw inputError("entries must be a JSON array");
  }
  if (raw.length < 1 || raw.length > MAX_ENTRIES_PER_PROPOSAL) {
    throw inputError(
      `a proposal carries 1 to ${MAX_ENTRIES_PER_PROPOSAL} entries`,
    );
  }
  return raw.map((entry) => normalizeEntry(entry));
}
