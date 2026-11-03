/**
 * Ledger service: the use-case layer tying validation, the proposal
 * registry and the store together. Recording always goes through a
 * proposal; the user-initiated delete is the one direct write (its
 * explicit UI confirmation replaces the proposal stage). Month reports
 * aggregate store rows in pure TypeScript. The clock is injected so tests
 * can drive auto-write, expiry and pruning.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../infrastructure/clock.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import type { LedgerStore } from "./store.ts";
import type { ProposalBody } from "./dto/create-proposal.dto.ts";
import { LedgerRequestError } from "./errors.ts";
import { createProposalRegistry, type ProposalRegistry } from "./proposals.ts";
import {
  type LedgerDraft,
  type LedgerExtractor,
  type LedgerFollowUp,
} from "./extraction.ts";
import { normalizeEntry } from "./validation.ts";
import type {
  LedgerCancelResult,
  LedgerCategorySummary,
  LedgerCommitResult,
  LedgerDeleteResult,
  LedgerMonthReport,
  LedgerProposalView,
  LedgerTransactionRow,
} from "./types.ts";

const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

const SWEEP_INTERVAL_MS = 1_000;

/** Aggregate one month's rows into the report shape (pure function). */
export function buildMonthReport(
  month: string,
  rows: readonly LedgerTransactionRow[],
): LedgerMonthReport {
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
    month,
    transactions: rows,
    income_total: incomeTotal,
    expense_total: expenseTotal,
    categories,
  };
}

/**
 * Proposal-timing knobs, overridable per test via the plugin options;
 * production uses the kernel defaults (empty overrides).
 */
export interface LedgerTiming {
  autoWriteDelayMs?: number;
  ttlMs?: number;
  retentionMs?: number;
}

/** A proposal, or the AI asking the user one clarifying question. */
export type LedgerProposalResult = LedgerProposalView | LedgerFollowUp;

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
  /** `body` has already passed the route's shape schema (dto/). */
  createProposal(body: ProposalBody): Promise<LedgerProposalResult>;
  commit(id: string): Promise<LedgerCommitResult>;
  cancel(id: string): Promise<LedgerCancelResult>;
  deleteTransaction(rawId: string): Promise<LedgerDeleteResult>;
  months(): Promise<{ months: readonly string[] }>;
  monthReport(month: string | undefined): Promise<LedgerMonthReport>;
  sweep(): Promise<void>;
  /** Starts the proposal sweeper timer. */
  start(): void;
  /**
   * Stops the sweeper timer and waits for a sweep still in flight, so the
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
    autoWriteDelayMs: deps.timing?.autoWriteDelayMs,
    ttlMs: deps.timing?.ttlMs,
    retentionMs: deps.timing?.retentionMs,
  });
  let timer: NodeJS.Timeout | undefined;
  /** The sweep the timer started and that has not settled yet. */
  let sweeping: Promise<void> | undefined;

  // The one-sentence branch: extract → (question | entries) → proposal.
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
    return registry.add(randomUUID(), draft.entries);
  }

  async function commit(id: string): Promise<LedgerCommitResult> {
    return registry.commit(id, (entries) =>
      store.insertTransactions(entries).then((transaction_ids) => ({
        written: entries.length,
        transaction_ids,
      })),
    );
  }

  async function sweep(): Promise<void> {
    for (const id of registry.dueForAutoWrite()) {
      // A failing write leaves the proposal pending; the next sweep
      // retries it until the TTL backstop expires the proposal.
      await commit(id).catch(() => undefined);
    }
    registry.sweep();
  }

  return {
    async createProposal(body) {
      if ("text" in body) {
        return createFromText(body.text);
      }
      const entry = normalizeEntry(body.entry);
      return registry.add(randomUUID(), [entry]);
    },

    commit,

    cancel(id) {
      return registry.cancel(id);
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

    sweep,

    // A 1 s tick bounds the auto-write moment's timing error to about a
    // second. Runs until the application shuts down; a tick that finds the
    // previous sweep still running skips, so sweeps never overlap.
    start() {
      timer = setInterval(() => {
        if (sweeping) {
          return;
        }
        // sweep swallows commit failures internally; this catch only guards
        // future edits that let something else throw — Node 22 kills the
        // process on an unhandled rejection.
        sweeping = sweep()
          .catch(() => undefined)
          .finally(() => {
            sweeping = undefined;
          });
      }, SWEEP_INTERVAL_MS);
      timer.unref();
    },

    async stop() {
      clearInterval(timer);
      await sweeping;
    },
  };
}
