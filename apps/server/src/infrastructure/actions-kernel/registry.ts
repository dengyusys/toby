/**
 * The actions kernel: the shared write state machine behind every
 * write-intent AI action (docs/decisions/actions-kernel.md and
 * docs/decisions/write-confirmation-tiers.md — the authoritative records of
 * the semantics below). One kernel, two orderings:
 *
 * - Gated (destructive operations): journal first, execute on confirm. A
 *   proposal is pending for a 30-second confirmation window — silence
 *   within the window counts as approval, so the server auto-executes it —
 *   with a 10-minute TTL as the hard expiry backstop.
 * - Immediate (additive operations): execute the transaction at once, then
 *   journal. The record is born confirmed — the card is a receipt — with a
 *   revert window (10 minutes by default); a revert applies the domain's
 *   before-snapshot in one transaction, user-clicked, no second gate, and
 *   refuses once the window has closed. Deliberately not general undo.
 *
 * Both tiers share the execution semantics: single-flight (the sweeper and
 * a manual confirm share one write; concurrent reverts share one
 * transaction) and idempotent forever after — the first result is stored
 * and echoed. Records are pruned an hour past their horizon, so memory
 * stays bounded; after that an id reports plain 404.
 *
 * The kernel is transport- and domain-agnostic: domains pass their own
 * executor (the transactional write) at commit/execute time and drive the
 * sweeper from their module; the kernel starts no timers of its own. The
 * registry is in-memory only: a process restart drops every unconfirmed
 * proposal and every open revert window (deliberate —
 * docs/decisions/actions-kernel.md).
 *
 * Error codes intentionally keep the ledger-era PROPOSAL_* names: they are
 * the wire contract the web apps match on. Renaming to ACTION_* is a
 * cross-client contract change, to be taken when the second domain adopts
 * the kernel.
 */

import { DomainHttpError } from "../http/http-error.ts";

const DEFAULT_ACTION_AUTO_WRITE_DELAY_MS = 30_000;
const DEFAULT_ACTION_TTL_MS = 10 * 60_000;
const DEFAULT_ACTION_REVERT_WINDOW_MS = 10 * 60_000;
const DEFAULT_ACTION_RETENTION_MS = 60 * 60_000;

/** The kernel's closed set of wire codes. */
export type ActionErrorCode =
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_EXPIRED"
  | "PROPOSAL_CANCELLED"
  | "PROPOSAL_COMMITTED"
  | "PROPOSAL_NOT_REVERTIBLE";

/** A proposal-state failure, answered by the unified HTTP error boundary. */
export class ActionStateError extends DomainHttpError {
  constructor(code: ActionErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "ActionStateError";
  }
}

export type ActionStatus =
  "pending" | "committed" | "cancelled" | "expired" | "reverted";

/** Raw record snapshot a domain adapter turns into its own view shape. */
export interface ActionRecord<P, R> {
  readonly id: string;
  readonly payload: P;
  // Mutable: the state machine advances status and stores the first result.
  status: ActionStatus;
  result?: R;
  readonly createdAtMs: number;
  readonly autoWriteAtMs: number;
  readonly expiresAtMs: number;
  /** Immediate tier only: until when a revert may apply the before-snapshot. */
  readonly revertUntilMs?: number;
  /** Set once a revert succeeded; echoed on idempotent re-reverts. */
  revertedAtMs?: number;
}

export interface ActionRegistryDeps {
  now: () => number;
  autoWriteDelayMs?: number;
  ttlMs?: number;
  /** Immediate tier: how long a born-confirmed record stays revertible. */
  revertWindowMs?: number;
  retentionMs?: number;
}

/** The immediate tier's revert outcome, domain-shaped by the adapter. */
export interface RevertOutcome {
  readonly id: string;
  readonly status: "reverted";
  readonly revertedAtMs: number;
}

export interface ActionRegistry<P, R> {
  add(id: string, payload: P): ActionRecord<P, R>;
  get(id: string): ActionRecord<P, R> | undefined;
  commit(id: string, execute: (payload: P) => Promise<R>): Promise<R>;
  cancel(id: string): Promise<{ id: string; status: "cancelled" }>;
  /**
   * The immediate tier: run the transaction now, then journal — the record
   * is born confirmed with a revert window. A failing executor leaves no
   * record; the failure propagates to the caller, who retries with a new
   * write.
   */
  execute(
    id: string,
    payload: P,
    execute: (payload: P) => Promise<R>,
  ): Promise<R>;
  /**
   * Apply the before-snapshot of an immediate-tier record inside its revert
   * window. Idempotent forever after (the outcome is echoed), single-flight
   * (concurrent reverts share one transaction); a failing compensating
   * transaction leaves the record committed — the domain's conflict
   * semantics decide whether a retry is worth offering.
   */
  revert(
    id: string,
    applyBefore: (payload: P, result: R) => Promise<void>,
  ): Promise<RevertOutcome>;
  /** Pending actions past their auto-write moment: not in flight, not yet expired. */
  dueForAutoWrite(): readonly string[];
  /** Mark expired; prune records past their retention horizon. */
  sweep(): void;
}

export function createActionRegistry<P, R>(
  deps: ActionRegistryDeps,
): ActionRegistry<P, R> {
  const now = deps.now;
  const autoWriteDelayMs =
    deps.autoWriteDelayMs ?? DEFAULT_ACTION_AUTO_WRITE_DELAY_MS;
  const ttlMs = deps.ttlMs ?? DEFAULT_ACTION_TTL_MS;
  const revertWindowMs = deps.revertWindowMs ?? DEFAULT_ACTION_REVERT_WINDOW_MS;
  const retentionMs = deps.retentionMs ?? DEFAULT_ACTION_RETENTION_MS;
  const records = new Map<
    string,
    ActionRecord<P, R> & {
      inFlight?: Promise<R>;
      revertInFlight?: Promise<RevertOutcome>;
    }
  >();

  function requireRecord(id: string): ActionRecord<P, R> & {
    inFlight?: Promise<R>;
    revertInFlight?: Promise<RevertOutcome>;
  } {
    const record = records.get(id);
    if (!record) {
      throw new ActionStateError(
        "PROPOSAL_NOT_FOUND",
        404,
        "proposal not found",
      );
    }
    return record;
  }

  return {
    add(id, payload) {
      const nowMs = now();
      const record = {
        id,
        payload,
        status: "pending" as const,
        createdAtMs: nowMs,
        autoWriteAtMs: nowMs + autoWriteDelayMs,
        expiresAtMs: nowMs + ttlMs,
      };
      records.set(id, record);
      return record;
    },

    get(id) {
      return records.get(id);
    },

    async commit(id, execute) {
      const record = requireRecord(id);
      if (record.status === "expired") {
        throw new ActionStateError(
          "PROPOSAL_EXPIRED",
          410,
          "proposal has expired",
        );
      }
      if (record.status === "cancelled") {
        throw new ActionStateError(
          "PROPOSAL_CANCELLED",
          409,
          "proposal was cancelled and cannot be committed",
        );
      }
      // Idempotent forever: the stored result is the answer. Judged by
      // status, not result presence — an executor legally returning
      // undefined must not lose its echo.
      if (record.status === "committed" || record.status === "reverted") {
        return record.result as R;
      }
      // Single-flight: the sweeper and a manual confirm share one write.
      if (record.inFlight) {
        return record.inFlight;
      }
      if (now() >= record.expiresAtMs) {
        record.status = "expired";
        throw new ActionStateError(
          "PROPOSAL_EXPIRED",
          410,
          "proposal has expired",
        );
      }
      const attempt = (async () => {
        try {
          const result = await execute(record.payload);
          record.status = "committed";
          record.result = result;
          record.inFlight = undefined;
          return result;
        } catch (error) {
          // Leave the record pending: the sweeper retries until expiry.
          record.inFlight = undefined;
          throw error;
        }
      })();
      record.inFlight = attempt;
      return attempt;
    },

    async cancel(id) {
      const record = requireRecord(id);
      if (record.status === "expired" || now() >= record.expiresAtMs) {
        record.status = "expired";
        throw new ActionStateError(
          "PROPOSAL_EXPIRED",
          410,
          "proposal has expired",
        );
      }
      if (record.status === "committed" || record.status === "reverted") {
        throw new ActionStateError(
          "PROPOSAL_COMMITTED",
          409,
          "proposal is already committed",
        );
      }
      // Same 409 code as the committed case on purpose: both mean "too
      // late to cancel"; the message distinguishes them for humans.
      if (record.inFlight) {
        throw new ActionStateError(
          "PROPOSAL_COMMITTED",
          409,
          "proposal commit is already in progress",
        );
      }
      record.status = "cancelled";
      return { id: record.id, status: "cancelled" as const };
    },

    async execute(id, payload, execute) {
      // Execute-then-journal: the transaction runs first; a failure
      // propagates and nothing is journalled, so the write cannot be
      // confirmed or reverted into existence later.
      const result = await execute(payload);
      const nowMs = now();
      const record: ActionRecord<P, R> & {
        inFlight?: Promise<R>;
        revertInFlight?: Promise<RevertOutcome>;
      } = {
        id,
        payload,
        status: "committed" as const,
        result,
        createdAtMs: nowMs,
        // Immediate records have no auto-write moment; the revert-window
        // end doubles as the sweep horizon (retention past it, as always).
        autoWriteAtMs: nowMs,
        expiresAtMs: nowMs + revertWindowMs,
        revertUntilMs: nowMs + revertWindowMs,
      };
      records.set(id, record);
      return result;
    },

    async revert(id, applyBefore) {
      const record = requireRecord(id);
      // Idempotent forever: a settled revert echoes its outcome, exactly
      // like a settled commit echoes its result.
      if (record.status === "reverted") {
        return {
          id: record.id,
          status: "reverted" as const,
          revertedAtMs: record.revertedAtMs ?? record.createdAtMs,
        };
      }
      if (record.status !== "committed" || record.revertUntilMs === undefined) {
        throw new ActionStateError(
          "PROPOSAL_NOT_REVERTIBLE",
          409,
          "only immediate-tier writes carry a revert window",
        );
      }
      if (now() >= record.revertUntilMs) {
        throw new ActionStateError(
          "PROPOSAL_EXPIRED",
          410,
          "revert window has closed — the card is a plain receipt",
        );
      }
      // Single-flight: concurrent reverts share one transaction.
      if (record.revertInFlight) {
        return record.revertInFlight;
      }
      const attempt = (async () => {
        try {
          await applyBefore(record.payload, record.result as R);
          const revertedAtMs = now();
          record.status = "reverted";
          record.revertedAtMs = revertedAtMs;
          record.revertInFlight = undefined;
          return { id: record.id, status: "reverted" as const, revertedAtMs };
        } catch (error) {
          // Leave the record committed: the domain's conflict semantics
          // (newer write wins) usually mean the retry would refuse too,
          // but a transient failure inside an open window may still land.
          record.revertInFlight = undefined;
          throw error;
        }
      })();
      record.revertInFlight = attempt;
      return attempt;
    },

    dueForAutoWrite() {
      const nowMs = now();
      const due: string[] = [];
      for (const record of records.values()) {
        if (
          record.status === "pending" &&
          !record.inFlight &&
          nowMs >= record.autoWriteAtMs &&
          nowMs < record.expiresAtMs
        ) {
          due.push(record.id);
        }
      }
      return due;
    },

    sweep() {
      const nowMs = now();
      for (const [id, record] of records) {
        if (record.status === "pending" && nowMs >= record.expiresAtMs) {
          record.status = "expired";
        }
        if (nowMs >= record.expiresAtMs + retentionMs) {
          records.delete(id);
        }
      }
    },
  };
}
