/**
 * Ledger service: the use-case layer tying validation, the proposal
 * registry and the store together. Every write goes through a proposal;
 * month reports aggregate store rows in pure TypeScript. The clock is
 * injected so tests can drive auto-write, expiry and pruning.
 */

import { randomUUID } from "node:crypto";
import { AiError } from "../../infrastructure/ai/errors.ts";
import type { AiClient } from "../../infrastructure/ai/types.ts";
import { type LedgerStore } from "./store.ts";
import { createProposalRegistry, type ProposalRegistry } from "./proposals.ts";
import {
  extractLedgerEntries,
  type LedgerDraft,
  type LedgerFollowUp,
} from "./extraction.ts";
import { normalizeEntry } from "./validation.ts";
import type {
  LedgerCancelResult,
  LedgerCategorySummary,
  LedgerCommitResult,
  LedgerMonthReport,
  LedgerProposalView,
  LedgerTransactionRow,
} from "./types.ts";

/** Domain-shaped error recognized by the unified HTTP error boundary. */
export class LedgerRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "LedgerRequestError";
    this.code = code;
    this.status = status;
  }
}

const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

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

export interface LedgerServiceDeps {
  now?: () => number;
  autoWriteDelayMs?: number;
  ttlMs?: number;
  retentionMs?: number;
  /** AI transport for the one-sentence path; absent keeps it 501. */
  ai?: AiClient;
}

/** A proposal, or the AI asking the user one clarifying question. */
export type LedgerProposalResult = LedgerProposalView | LedgerFollowUp;

export interface LedgerService {
  createProposal(body: unknown): Promise<LedgerProposalResult>;
  commit(id: string): Promise<LedgerCommitResult>;
  cancel(id: string): Promise<LedgerCancelResult>;
  months(): Promise<{ months: readonly string[] }>;
  monthReport(month: string | undefined): Promise<LedgerMonthReport>;
  sweep(): Promise<void>;
}

function aiHttpError(error: AiError): LedgerRequestError {
  if (error.code === "unconfigured") {
    return new LedgerRequestError(
      "AI_UNAVAILABLE",
      501,
      "AI is not configured: set TOBY_AI_API_KEY and TOBY_AI_MODEL",
    );
  }
  return new LedgerRequestError("AI_REQUEST_FAILED", 502, error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assembleLedgerService(
  store: LedgerStore,
  deps: LedgerServiceDeps = {},
): LedgerService {
  const now = deps.now ?? Date.now;
  const registry: ProposalRegistry = createProposalRegistry({
    now,
    autoWriteDelayMs: deps.autoWriteDelayMs,
    ttlMs: deps.ttlMs,
    retentionMs: deps.retentionMs,
  });

  return {
    async createProposal(body) {
      if (!isRecord(body)) {
        throw new LedgerRequestError(
          "INVALID_ENTRY",
          400,
          "request body must be a JSON object",
        );
      }
      if (typeof body.text === "string") {
        const text = body.text.trim();
        if (!text) {
          throw new LedgerRequestError(
            "INVALID_ENTRY",
            400,
            "text must not be empty",
          );
        }
        if (!deps.ai) {
          throw new LedgerRequestError(
            "AI_UNAVAILABLE",
            501,
            "the one-sentence AI path needs an AI transport; use the structured entry path",
          );
        }
        let draft: LedgerDraft;
        try {
          draft = await extractLedgerEntries(deps.ai, text, {
            now: () => new Date(now()),
          });
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
      const entry = normalizeEntry(body.entry);
      return registry.add(randomUUID(), [entry]);
    },

    commit(id) {
      return registry.commit(id, (entries) =>
        store.insertTransactions(entries).then((transaction_ids) => ({
          written: entries.length,
          transaction_ids,
        })),
      );
    },

    cancel(id) {
      return registry.cancel(id);
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

    async sweep() {
      for (const id of registry.dueForAutoWrite()) {
        // A failing write leaves the proposal pending; the next sweep
        // retries it until the TTL backstop expires the proposal.
        await this.commit(id).catch(() => undefined);
      }
      registry.sweep();
    },
  };
}
