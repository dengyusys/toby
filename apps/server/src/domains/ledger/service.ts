/**
 * Ledger service: the use-case layer tying validation, the proposal
 * registry and the store together. Every write goes through a proposal;
 * month reports aggregate store rows in pure TypeScript. The clock is
 * injected so tests can drive auto-write, expiry and pruning.
 */

import { randomUUID } from "node:crypto";
import { AiError } from "../../infrastructure/ai/errors.ts";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import type { Logger } from "../../infrastructure/logging/logger.ts";
import { type LedgerStore } from "./store.ts";
import { LedgerRequestError } from "./errors.ts";
import { createProposalRegistry, type ProposalRegistry } from "./proposals.ts";
import {
  type LedgerDraft,
  type LedgerExtractor,
  type LedgerFollowUp,
} from "./extraction.ts";
import { isRecord, normalizeEntry } from "./validation.ts";
import type {
  LedgerCancelResult,
  LedgerCategorySummary,
  LedgerCommitResult,
  LedgerMonthReport,
  LedgerProposalView,
  LedgerTransactionRow,
} from "./types.ts";

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
  /** Extraction agent for the one-sentence path; absent keeps it 501. */
  extractor?: LedgerExtractor;
  /** pino logger; auto-write failures surface here instead of dying silent. */
  logger?: Logger;
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

/** One message for every 501 AI_UNAVAILABLE path. */
const AI_UNCONFIGURED_MESSAGE =
  'AI is not configured: set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")';

function aiHttpError(error: AiError): LedgerRequestError {
  if (error.code === "unconfigured") {
    return new LedgerRequestError(
      "AI_UNAVAILABLE",
      HTTP_STATUS.notImplemented,
      AI_UNCONFIGURED_MESSAGE,
    );
  }
  return new LedgerRequestError(
    "AI_REQUEST_FAILED",
    HTTP_STATUS.badGateway,
    error.message,
  );
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

  // The one-sentence branch: extract → (question | entries) → proposal.
  // A named step so createProposal stays a thin dispatcher.
  const createFromText = async (
    rawText: string,
  ): Promise<LedgerProposalResult> => {
    const text = rawText.trim();
    if (!text) {
      throw new LedgerRequestError(
        "INVALID_ENTRY",
        HTTP_STATUS.badRequest,
        "text must not be empty",
      );
    }
    if (!deps.extractor) {
      throw new LedgerRequestError(
        "AI_UNAVAILABLE",
        HTTP_STATUS.notImplemented,
        AI_UNCONFIGURED_MESSAGE,
      );
    }
    let draft: LedgerDraft;
    try {
      draft = await deps.extractor.extract(text, new Date(now()));
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
  };

  return {
    async createProposal(body) {
      if (!isRecord(body)) {
        throw new LedgerRequestError(
          "INVALID_ENTRY",
          HTTP_STATUS.badRequest,
          "request body must be a JSON object",
        );
      }
      if (typeof body.text === "string") {
        return createFromText(body.text);
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
          HTTP_STATUS.badRequest,
          'month query parameter is required as "YYYY-MM"',
        );
      }
      const rows = await store.listMonthTransactions(month);
      return buildMonthReport(month, rows);
    },

    async sweep() {
      for (const id of registry.dueForAutoWrite()) {
        // A failing write leaves the proposal pending; the next sweep
        // retries it until the TTL backstop expires the proposal. The
        // failure is logged so a persistently failing store never eats
        // data silently.
        await this.commit(id).catch((error: unknown) => {
          deps.logger?.warn(
            { proposal_id: id, err: error },
            "auto-write failed; retrying until the proposal expires",
          );
        });
      }
      registry.sweep();
    },
  };
}
