/**
 * Ledger service: the use-case layer tying validation and the repository
 * together. Recording is a direct write:
 * a validated batch executes as one repository transaction and the receipt
 * is what landed; the user-initiated delete is the other write (its explicit
 * UI click stands in for the card path). Month reports aggregate repository
 * rows in pure TypeScript.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { localDate } from "../../infrastructure/local-date.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import type { LedgerRepository } from "./repository.ts";
import type { EntryBody } from "./schema.ts";
import { LedgerRequestError } from "./errors.ts";
import {
  type LedgerDraft,
  type LedgerExtractor,
  type LedgerFollowUp,
} from "./extraction.ts";
import {
  normalizeEntry,
  normalizeEntryPatch,
  parseEntryDate,
} from "./validation.ts";
import type {
  LedgerCategorySummary,
  LedgerDayReport,
  LedgerDeleteResult,
  LedgerEditMatch,
  LedgerEntry,
  LedgerEntryPatch,
  LedgerMonthReport,
  LedgerReceiptView,
  LedgerTransactionRow,
  LedgerUpdateResult,
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

/** A landed receipt, a landed edit, or the AI asking one clarifying question. */
export type LedgerWriteResult =
  LedgerReceiptView | LedgerUpdateResult | LedgerFollowUp;

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
  /**
   * Update one stored transaction. `rawPatch` has passed the route's
   * shape schema; its semantics are validated here, then the update is
   * one repository transaction whose before/after pair is returned.
   */
  updateTransaction(
    rawId: string,
    rawPatch: unknown,
  ): Promise<LedgerUpdateResult>;
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

  // The shared update path: one repository transaction, before/after out.
  async function applyUpdate(
    id: number,
    patch: LedgerEntryPatch,
  ): Promise<LedgerUpdateResult> {
    const updated = await repository.updateTransaction(id, patch);
    if (!updated) {
      throw new LedgerRequestError(
        "TRANSACTION_NOT_FOUND",
        404,
        "transaction does not exist (it may already be deleted)",
      );
    }
    return {
      transaction_id: id,
      status: "updated" as const,
      ...updated,
      updated_at: new Date(clock()).toISOString(),
    };
  }

  // Deterministic edit resolution: the match's criteria narrow one day's
  // rows (the day named, else today); the AI never supplies a row id.
  async function resolveEditCandidates(
    match: LedgerEditMatch,
    now: Date,
  ): Promise<{ date: string; candidates: readonly LedgerTransactionRow[] }> {
    const date = match.date ?? localDate(now);
    const rows = await repository.listDayTransactions(date);
    const candidates = rows.filter(
      (row) =>
        (match.type === undefined || row.type === match.type) &&
        (match.category === undefined || row.category === match.category) &&
        (match.note_contains === undefined ||
          row.note.includes(match.note_contains)),
    );
    return { date, candidates };
  }

  /** One candidate line for the ambiguity question, id-free. */
  function describeCandidate(row: LedgerTransactionRow): string {
    const direction = row.type === "income" ? "收" : "支";
    const note = row.note ? `(${row.note})` : "";
    return `${direction} ¥${(row.amount / 100).toFixed(2)} ${row.category}${note}`;
  }

  /** The criteria as one noun phrase for the question copy. */
  function describeMatch(match: LedgerEditMatch, date: string): string {
    const parts: string[] = [];
    if (match.category !== undefined) {
      parts.push(match.category);
    }
    if (match.note_contains !== undefined) {
      parts.push(`备注含「${match.note_contains}」`);
    }
    if (match.type !== undefined) {
      parts.push(match.type === "income" ? "收入" : "支出");
    }
    return parts.length > 0 ? `${date} 的${parts.join(", ")}` : date;
  }

  // The one-sentence edit branch: resolve → (question | update). Zero or
  // several candidates are a question, never a guess — the reply names the
  // day and the criteria so the next sentence can pin the entry down.
  async function writeEdit(
    edit: { match: LedgerEditMatch; patch: LedgerEntryPatch },
    now: Date,
  ): Promise<LedgerUpdateResult | LedgerFollowUp> {
    const { date, candidates } = await resolveEditCandidates(edit.match, now);
    const described = describeMatch(edit.match, date);
    if (candidates.length === 0) {
      return {
        question: `没有找到${described}的记录,要改的是哪天哪笔?`,
      };
    }
    if (candidates.length > 1) {
      const lines = candidates
        .slice(0, 5)
        .map((row) => describeCandidate(row))
        .join(";");
      return {
        question: `找到 ${candidates.length} 笔${described}的记录:${lines}。要改哪一笔?`,
      };
    }
    return applyUpdate(candidates[0]!.id, edit.patch);
  }

  // The one-sentence branch: extract → (question | entries | edit) → receipt.
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
    // Silent learning: memory receipts the extraction run landed ride on
    // the result it produced — absent when the run wrote no memory, so
    // old responses stay byte-identical. A follow-up question carries
    // none: it has no receipt channel (the memory writes themselves still
    // landed and show their own cards through the tools).
    const memoryReceipts = draft.memory_receipts;
    if ("edit" in draft) {
      const result = await writeEdit(draft.edit, new Date(clock()));
      if ("question" in result || memoryReceipts === undefined) {
        return result;
      }
      return { ...result, memory_receipts: memoryReceipts };
    }
    const receipt = await writeBatch(draft.entries);
    return memoryReceipts === undefined
      ? receipt
      : { ...receipt, memory_receipts: memoryReceipts };
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

    async updateTransaction(rawId, rawPatch) {
      const id = Number.parseInt(rawId, 10);
      if (!Number.isInteger(id) || id < 1) {
        throw new LedgerRequestError(
          "INVALID_ENTRY",
          400,
          "transaction id must be a positive integer",
        );
      }
      // Throws LedgerInputError (INVALID_ENTRY) on a bad or empty patch.
      const patch = normalizeEntryPatch(rawPatch);
      return applyUpdate(id, patch);
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
