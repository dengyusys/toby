/**
 * Ledger service: the use-case layer tying validation, the write registry
 * and the store together. Recording is immediate-tier
 * (docs/decisions/write-confirmation-tiers.md): a validated batch executes
 * transactionally at once and the receipt is born confirmed with a revert
 * window; the user-initiated delete is the one direct write (its explicit
 * UI confirmation stands in for the card path). Month reports aggregate
 * store rows in pure TypeScript. The clock is injected so tests can drive
 * the revert window and pruning.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../infrastructure/clock.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import type { LedgerStore } from "./store.ts";
import type { ProposalBody } from "./schema.ts";
import { LedgerRequestError } from "./errors.ts";
import { createProposalRegistry, type ProposalRegistry } from "./proposals.ts";
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
  LedgerRevertResult,
  LedgerTransactionRow,
} from "./types.ts";

const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const PRUNE_INTERVAL_MS = 1_000;

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

/**
 * Write-timing knobs, overridable per test via the plugin options;
 * production uses the kernel defaults (empty overrides).
 */
export interface LedgerTiming {
  revertWindowMs?: number;
  retentionMs?: number;
}

/** A landed receipt, or the AI asking the user one clarifying question. */
export type LedgerProposalResult = LedgerReceiptView | LedgerFollowUp;

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
  createProposal(body: ProposalBody): Promise<LedgerProposalResult>;
  /** Apply the batch's before-snapshot inside the revert window. */
  revert(id: string): Promise<LedgerRevertResult>;
  deleteTransaction(rawId: string): Promise<LedgerDeleteResult>;
  months(): Promise<{ months: readonly string[] }>;
  monthReport(month: string | undefined): Promise<LedgerMonthReport>;
  /** One local day's report; the date is validated as a real calendar date. */
  dayReport(date: string): Promise<LedgerDayReport>;
  /** Starts the record pruner timer. */
  start(): void;
  /**
   * Stops the pruner timer and waits for a prune still in flight, so the
   * store can close behind it.
   */
  stop(): Promise<void>;
}

export function createLedgerService(deps: {
  store: LedgerStore;
  clock: Clock;
  /** Absent while AI is unconfigured; the text path then answers 501. */
  extractor?: LedgerExtractor;
  timing?: LedgerTiming;
}): LedgerService {
  const { store, clock, extractor } = deps;
  const registry: ProposalRegistry = createProposalRegistry({
    now: clock,
    revertWindowMs: deps.timing?.revertWindowMs,
    retentionMs: deps.timing?.retentionMs,
  });
  let timer: NodeJS.Timeout | undefined;
  /** The prune the timer started and that has not settled yet. */
  let pruning: Promise<void> | undefined;

  function executeBatch(
    id: string,
    entries: readonly LedgerEntry[],
  ): Promise<LedgerReceiptView> {
    return registry.execute(id, entries, async (batch) => {
      const transaction_ids = await store.insertTransactions(batch);
      return { written: batch.length, transaction_ids };
    });
  }

  // The one-sentence branch: extract → (question | entries) → receipt.
  async function createFromText(
    rawText: string,
  ): Promise<LedgerProposalResult> {
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
    return executeBatch(randomUUID(), draft.entries);
  }

  return {
    async createProposal(body) {
      if ("text" in body) {
        return createFromText(body.text);
      }
      const entry = normalizeEntry(body.entry);
      return executeBatch(randomUUID(), [entry]);
    },

    async revert(id) {
      return registry.revert(id, async (outcome) => {
        const untouched = await store.revertTransactions(
          outcome.transaction_ids,
        );
        if (!untouched) {
          throw new LedgerRequestError(
            "REVERT_CONFLICT",
            409,
            "a later write touched this batch — the newer write wins",
          );
        }
      });
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
      const deleted = await store.deleteTransaction(id);
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
      return { months: await store.listMonths() };
    },

    async monthReport(month) {
      if (month === undefined || !MONTH_PATTERN.test(month)) {
        throw new LedgerRequestError(
          "INVALID_MONTH",
          400,
          'month query parameter is required as "YYYY-MM"',
        );
      }
      const rows = await store.listMonthTransactions(month);
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
      return buildDayReport(date, await store.listDayTransactions(date));
    },

    // A 1 s tick prunes journalled records past their retention horizon,
    // keeping memory bounded. Runs until the application shuts down; a
    // tick that finds the previous prune still running skips, so prunes
    // never overlap.
    start() {
      timer = setInterval(() => {
        if (pruning) {
          return;
        }
        pruning = (async () => {
          registry.sweep();
        })()
          .catch(() => undefined)
          .finally(() => {
            pruning = undefined;
          });
      }, PRUNE_INTERVAL_MS);
      timer.unref();
    },

    async stop() {
      clearInterval(timer);
      await pruning;
    },
  };
}
