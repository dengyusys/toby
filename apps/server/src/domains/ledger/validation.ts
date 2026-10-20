/**
 * Deterministic entry validation and normalization. Everything that enters
 * the ledger — the structured path today, AI output later — passes through
 * here: untrusted input in, a fully normalized LedgerEntry out, or a
 * rejected request with zero proposals and zero writes. Amounts parse as
 * strings split into cents, so no floating-point arithmetic ever touches
 * money.
 */

import type { LedgerEntry, LedgerEntryType } from "./types.ts";

/** Domain-shaped error picked up by the unified HTTP error boundary. */
export class LedgerInputError extends Error {
  readonly code = "INVALID_ENTRY";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "LedgerInputError";
  }
}

const MAX_CATEGORY_LENGTH = 24;
const MAX_ACCOUNT_LENGTH = 24;
const MAX_NOTE_LENGTH = 200;
/**
 * One-sentence logging rarely names an account; an omitted or blank account
 * settles on this placeholder instead of a rejection or a follow-up.
 */
export const DEFAULT_LEDGER_ACCOUNT = "未关联";
/** A proposal carries at most 10 entries (multi-entry arrives with the AI path). */
export const MAX_ENTRIES_PER_PROPOSAL = 10;

const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function inputError(message: string): LedgerInputError {
  return new LedgerInputError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Non-negative amount with at most two decimals ("25", "25.5", "25.50",
 * 25.5), parsed digit-wise into integer cents. Rejects negatives, three+
 * decimals, exponent forms and anything a human did not type as money.
 */
export function parseAmountToCents(value: unknown, field = "amount"): number {
  const text =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : null;
  if (text === null || !AMOUNT_PATTERN.test(text)) {
    throw inputError(
      `${field} must be a non-negative number with at most two decimals`,
    );
  }
  const [wholePart, fractionPart = ""] = text.split(".");
  const cents = Number(`${wholePart}${fractionPart.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    throw inputError(`${field} is too large`);
  }
  return cents;
}

/**
 * Local "YYYY-MM-DD" with real calendar checking (month range, month
 * length, leap years). Any past or future year is valid — backfilling is a
 * first-class flow.
 */
export function parseEntryDate(value: unknown, field = "date"): string {
  if (typeof value !== "string") {
    throw inputError(`${field} must be a "YYYY-MM-DD" string`);
  }
  const match = DATE_PATTERN.exec(value.trim());
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

function parseText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) {
    throw inputError(`${field} is required`);
  }
  if (typeof value !== "string") {
    throw inputError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    throw inputError(`${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw inputError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function parseType(value: unknown): LedgerEntryType {
  if (value !== "income" && value !== "expense") {
    throw inputError('type must be "income" or "expense"');
  }
  return value;
}

/** Account is optional: missing, null or blank settles on the default. */
function parseAccount(value: unknown): string {
  if (value === undefined || value === null) {
    return DEFAULT_LEDGER_ACCOUNT;
  }
  if (typeof value !== "string") {
    throw inputError("account must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return DEFAULT_LEDGER_ACCOUNT;
  }
  if (trimmed.length > MAX_ACCOUNT_LENGTH) {
    throw inputError(
      `account must be at most ${MAX_ACCOUNT_LENGTH} characters`,
    );
  }
  return trimmed;
}

/** Validate and normalize one raw entry into its storable form. */
export function normalizeEntry(raw: unknown): LedgerEntry {
  if (!isRecord(raw)) {
    throw inputError("entry must be a JSON object");
  }
  const note = typeof raw.note === "undefined" ? "" : raw.note;
  if (typeof note !== "string") {
    throw inputError("note must be a string");
  }
  const trimmedNote = note.trim();
  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    throw inputError(`note must be at most ${MAX_NOTE_LENGTH} characters`);
  }
  return {
    date: parseEntryDate(raw.date),
    type: parseType(raw.type),
    category: parseText(raw.category, "category", MAX_CATEGORY_LENGTH),
    account: parseAccount(raw.account),
    amount: parseAmountToCents(raw.amount),
    note: trimmedNote,
  };
}

/** Validate a batch (1..MAX) — the AI multi-entry path lands on this later. */
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
