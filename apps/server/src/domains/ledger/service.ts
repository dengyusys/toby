/**
 * Ledger service: the use-case layer tying validation and the repository
 * together. Recording is a direct write:
 * a validated batch executes as one repository transaction and the receipt
 * is what landed; the user-initiated delete is the other write (its explicit
 * UI click stands in for the card path). Month reports aggregate repository
 * rows in pure TypeScript.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import type { LedgerRepository } from "./repository.ts";
import type { EntryBody } from "./schema.ts";
import { LedgerRequestError } from "./errors.ts";
import {
  type LedgerDraft,
  type LedgerExtractor,
  type LedgerFollowUp,
} from "./extraction.ts";
import { normalizeEntry, parseEntryDate } from "./validation.ts";
import type {
  LedgerCategorySummary,
  LedgerDayReport,
  LedgerDeleteResult,
  LedgerEntry,
  LedgerMonthReport,
  LedgerReceiptView,
  LedgerTransactionRow,
} from "./types.ts";

const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** A report's totals and category subtotals (shared by the month/day views). */
function summarize(rows: readonly LedgerTransactionRow[]): {
  income_total: number;
  expense_total: number;
  categories: LedgerCategorySummary[];
} {
  let incomeTotal = 0;
  let expenseTotal = 0;
  const categoryTotals = new Map<string, LedgerCategorySummary>();
  for (const row of rows) {
    if (row.type === "income") {
      incomeTotal += row.amount;
    } else {
      expenseTotal += row.amount;
    }
    const key = `${row.type}:${row.category}`;
    const current = categoryTotals.get(key);
    categoryTotals.set(key, {
      type: row.type,
      category: row.category,
      total: (current?.total ?? 0) + row.amount,
    });
  }
  const categories = [...categoryTotals.values()].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "expense" ? -1 : 1;
    }
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return a.category < b.category ? -1 : 1;
  });
  return {
    income_total: incomeTotal,
    expense_total: expenseTotal,
    categories,
  };
}

/** Aggregate one month's rows into the report shape (pure function). */
export function buildMonthReport(
  month: string,
  rows: readonly LedgerTransactionRow[],
): LedgerMonthReport {
  return { month, transactions: rows, ...summarize(rows) };
}

/** Aggregate one day's rows into the same shape (pure function). */
export function buildDayReport(
  date: string,
  rows: readonly LedgerTransactionRow[],
): LedgerDayReport {
  return { date, transactions: rows, ...summarize(rows) };
}

/** A landed receipt, or the AI asking the user one clarifying question. */
export type LedgerWriteResult = LedgerReceiptView | LedgerFollowUp;

/** One message for every 501 AI_UNAVAILABLE path. */
const AI_UNCONFIGURED_MESSAGE =
  'AI is not configured: set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")';

function aiHttpError(error: AiError): LedgerRequestError {
  if (error.code === "unconfigured") {
    return new LedgerRequestError(
      "AI_UNAVAILABLE",
      501,
      AI_UNCONFIGURED_MESSAGE,
    );
  }
  return new LedgerRequestError("AI_REQUEST_FAILED", 502, error.message);
}

export interface LedgerService {
  /** `body` has already passed the route's shape schema (schema.ts). */
  write(body: EntryBody): Promise<LedgerWriteResult>;
  deleteTransaction(rawId: string): Promise<LedgerDeleteResult>;
  months(): Promise<{ months: readonly string[] }>;
  monthReport(month: string | undefined): Promise<LedgerMonthReport>;
  /** One local day's report; the date is validated as a real calendar date. */
  dayReport(date: string): Promise<LedgerDayReport>;
}

export function createLedgerService(deps: {
  repository: LedgerRepository;
  clock: Clock;
  /** Absent while AI is unconfigured; the text path then answers 501. */
  extractor?: LedgerExtractor;
}): LedgerService {
  const { repository, clock, extractor } = deps;

  // One write = one repository transaction; the id is a trace id for logs.
  async function writeBatch(
    entries: readonly LedgerEntry[],
  ): Promise<LedgerReceiptView> {
    const transaction_ids = await repository.insertTransactions(entries);
    return {
      written: entries.length,
      transaction_ids,
      entries,
      created_at: new Date(clock()).toISOString(),
    };
  }

  // The one-sentence branch: extract → (question | entries) → receipt.
  async function writeFromText(rawText: string): Promise<LedgerWriteResult> {
    const text = rawText.trim();
    if (!text) {
      throw new LedgerRequestError(
        "INVALID_ENTRY",
        400,
        "text must not be empty",
      );
    }
    if (!extractor) {
      throw new LedgerRequestError(
        "AI_UNAVAILABLE",
        501,
        AI_UNCONFIGURED_MESSAGE,
      );
    }
    let draft: LedgerDraft;
    try {
      draft = await extractor.extract(text, new Date(clock()));
    } catch (error) {
      if (error instanceof AiError) {
        throw aiHttpError(error);
      }
      throw error;
    }
    if ("question" in draft) {
      return draft;
    }
    return writeBatch(draft.entries);
  }

  return {
    async write(body) {
      if ("text" in body) {
        return writeFromText(body.text);
      }
      return writeBatch([normalizeEntry(body.entry)]);
    },

    async deleteTransaction(rawId) {
      const id = Number.parseInt(rawId, 10);
      if (!Number.isInteger(id) || id < 1) {
        throw new LedgerRequestError(
          "INVALID_ENTRY",
          400,
          "transaction id must be a positive integer",
        );
      }
      const deleted = await repository.deleteTransaction(id);
      if (!deleted) {
        throw new LedgerRequestError(
          "TRANSACTION_NOT_FOUND",
          404,
          "transaction does not exist (it may already be deleted)",
        );
      }
      return {
        transaction_id: id,
        status: "deleted",
        deleted_at: new Date(clock()).toISOString(),
      };
    },

    async months() {
      return { months: await repository.listMonths() };
    },

    async monthReport(month) {
      if (month === undefined || !MONTH_PATTERN.test(month)) {
        throw new LedgerRequestError(
          "INVALID_MONTH",
          400,
          'month query parameter is required as "YYYY-MM"',
        );
      }
      const rows = await repository.listMonthTransactions(month);
      return buildMonthReport(month, rows);
    },

    async dayReport(rawDate) {
      let date: string;
      try {
        date = parseEntryDate(rawDate, "date");
      } catch {
        throw new LedgerRequestError(
          "INVALID_DATE",
          400,
          'date is required as a real "YYYY-MM-DD" calendar date',
        );
      }
      return buildDayReport(date, await repository.listDayTransactions(date));
    },
  };
}
