/**
 * Ledger service: the use-case layer tying validation, the proposal
 * registry and the store together. Recording always goes through a
 * proposal; the user-initiated delete is the one direct write (its
 * explicit UI confirmation replaces the proposal stage). Month reports
 * aggregate store rows in pure TypeScript. The clock is injected by token
 * so tests can drive auto-write, expiry and pruning.
 */

import { randomUUID } from "node:crypto";
import {
  Inject,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { AiError } from "../../infrastructure/model/errors.ts";
import {
  CLOCK,
  type Clock,
} from "../../infrastructure/providers/shared-tokens.ts";
import { LedgerStore } from "./store.ts";
import type { ProposalBody } from "./dto/create-proposal.dto.ts";
import { LedgerRequestError } from "./errors.ts";
import { createProposalRegistry, type ProposalRegistry } from "./proposals.ts";
import {
  type LedgerDraft,
  type LedgerExtractor,
  type LedgerFollowUp,
} from "./extraction.ts";
import { normalizeEntry } from "./validation.ts";
import { LEDGER_EXTRACTOR, LEDGER_TIMING } from "./tokens.ts";
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
 * Proposal-timing knobs, overridable per test via the LEDGER_TIMING token;
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
      HttpStatus.NOT_IMPLEMENTED,
      AI_UNCONFIGURED_MESSAGE,
    );
  }
  return new LedgerRequestError(
    "AI_REQUEST_FAILED",
    HttpStatus.BAD_GATEWAY,
    error.message,
  );
}

@Injectable()
export class LedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly registry: ProposalRegistry;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: LedgerStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LEDGER_TIMING) timing: LedgerTiming,
    @Inject(LEDGER_EXTRACTOR)
    private readonly extractor: LedgerExtractor | undefined,
  ) {
    this.registry = createProposalRegistry({
      now: this.clock,
      autoWriteDelayMs: timing.autoWriteDelayMs,
      ttlMs: timing.ttlMs,
      retentionMs: timing.retentionMs,
    });
  }

  // A 1 s tick bounds the auto-write moment's timing error to about a
  // second. Runs until the application shuts down.
  onModuleInit(): void {
    this.timer = setInterval(() => {
      // sweep swallows commit failures internally; this catch only guards
      // future edits that let something else throw — Node 22 kills the
      // process on an unhandled rejection.
      this.sweep().catch(() => undefined);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  // Teardown ordering: Nest destroys providers by descending dependency
  // depth, and this service sits above LedgerStore (which closes the
  // database) in that chain — so the timer is cleared first. Do not break
  // the LedgerService → LedgerStore dependency chain.
  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** `body` has already passed the route's shape schema (dto/). */
  async createProposal(body: ProposalBody): Promise<LedgerProposalResult> {
    if ("text" in body) {
      return this.createFromText(body.text);
    }
    const entry = normalizeEntry(body.entry);
    return this.registry.add(randomUUID(), [entry]);
  }

  // The one-sentence branch: extract → (question | entries) → proposal.
  // A named step so createProposal stays a thin dispatcher.
  private async createFromText(rawText: string): Promise<LedgerProposalResult> {
    const text = rawText.trim();
    if (!text) {
      throw new LedgerRequestError(
        "INVALID_ENTRY",
        HttpStatus.BAD_REQUEST,
        "text must not be empty",
      );
    }
    if (!this.extractor) {
      throw new LedgerRequestError(
        "AI_UNAVAILABLE",
        HttpStatus.NOT_IMPLEMENTED,
        AI_UNCONFIGURED_MESSAGE,
      );
    }
    let draft: LedgerDraft;
    try {
      draft = await this.extractor.extract(text, new Date(this.clock()));
    } catch (error) {
      if (error instanceof AiError) {
        throw aiHttpError(error);
      }
      throw error;
    }
    if ("question" in draft) {
      return draft;
    }
    return this.registry.add(randomUUID(), draft.entries);
  }

  commit(id: string): Promise<LedgerCommitResult> {
    return this.registry.commit(id, (entries) =>
      this.store.insertTransactions(entries).then((transaction_ids) => ({
        written: entries.length,
        transaction_ids,
      })),
    );
  }

  cancel(id: string): Promise<LedgerCancelResult> {
    return this.registry.cancel(id);
  }

  /**
   * User-initiated delete of one stored transaction. The route parameter
   * arrives as a string; ids are positive integers.
   */
  async deleteTransaction(rawId: string): Promise<LedgerDeleteResult> {
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id) || id < 1) {
      throw new LedgerRequestError(
        "INVALID_ENTRY",
        HttpStatus.BAD_REQUEST,
        "transaction id must be a positive integer",
      );
    }
    const deleted = await this.store.deleteTransaction(id);
    if (!deleted) {
      throw new LedgerRequestError(
        "TRANSACTION_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        "transaction does not exist (it may already be deleted)",
      );
    }
    return {
      transaction_id: id,
      status: "deleted",
      deleted_at: new Date(this.clock()).toISOString(),
    };
  }

  async months(): Promise<{ months: readonly string[] }> {
    return { months: await this.store.listMonths() };
  }

  async monthReport(month: string | undefined): Promise<LedgerMonthReport> {
    if (month === undefined || !MONTH_PATTERN.test(month)) {
      throw new LedgerRequestError(
        "INVALID_MONTH",
        HttpStatus.BAD_REQUEST,
        'month query parameter is required as "YYYY-MM"',
      );
    }
    const rows = await this.store.listMonthTransactions(month);
    return buildMonthReport(month, rows);
  }

  async sweep(): Promise<void> {
    for (const id of this.registry.dueForAutoWrite()) {
      // A failing write leaves the proposal pending; the next sweep
      // retries it until the TTL backstop expires the proposal.
      await this.commit(id).catch(() => undefined);
    }
    this.registry.sweep();
  }
}
