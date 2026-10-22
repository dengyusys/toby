/**
 * The actions kernel: the shared confirm-gate state machine behind every
 * write-intent AI action (docs/decisions/ai-pi-runtime.md). A proposal is
 * pending for a 30-second confirmation window — silence within the window
 * counts as approval, so the server auto-executes it (tacit approval fits
 * the chat flow: not pressing cancel means go) — with a 10-minute TTL as
 * the hard expiry backstop. Execution is single-flight (the sweeper and a
 * manual confirm share one write) and idempotent forever after: the first
 * result is stored and echoed. Records are pruned an hour after expiry, so
 * memory stays bounded; after that a commit reports plain 404.
 *
 * The kernel is transport- and domain-agnostic: domains pass their own
 * executor (the transactional write) at commit time and drive the sweeper
 * from their module; the kernel starts no timers of its own.
 *
 * Error codes intentionally keep the ledger-era PROPOSAL_* names: they are
 * the wire contract the web apps match on. Renaming to ACTION_* is a
 * cross-client contract change, to be taken when the second domain adopts
 * the kernel.
 */

import { HTTP_STATUS } from "../http/contract.ts";

const DEFAULT_ACTION_AUTO_WRITE_DELAY_MS = 30_000;
const DEFAULT_ACTION_TTL_MS = 10 * 60_000;
const DEFAULT_ACTION_RETENTION_MS = 60 * 60_000;

/** Domain-shaped error recognized by the unified HTTP error boundary. */
export class ActionStateError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ActionStateError";
    this.code = code;
    this.status = status;
  }
}

export type ActionStatus = "pending" | "committed" | "cancelled" | "expired";

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
}

export interface ActionRegistryDeps {
  now: () => number;
  autoWriteDelayMs?: number;
  ttlMs?: number;
  retentionMs?: number;
}

export interface ActionRegistry<P, R> {
  add(id: string, payload: P): ActionRecord<P, R>;
  get(id: string): ActionRecord<P, R> | undefined;
  commit(id: string, execute: (payload: P) => Promise<R>): Promise<R>;
  cancel(id: string): Promise<{ id: string; status: "cancelled" }>;
  /** Pending actions past their auto-write moment, not yet expired. */
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
  const retentionMs = deps.retentionMs ?? DEFAULT_ACTION_RETENTION_MS;
  const records = new Map<
    string,
    ActionRecord<P, R> & { inFlight?: Promise<R> }
  >();

  function requireRecord(
    id: string,
  ): ActionRecord<P, R> & { inFlight?: Promise<R> } {
    const record = records.get(id);
    if (!record) {
      throw new ActionStateError(
        "PROPOSAL_NOT_FOUND",
        HTTP_STATUS.notFound,
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
          HTTP_STATUS.gone,
          "proposal has expired",
        );
      }
      if (record.status === "cancelled") {
        throw new ActionStateError(
          "PROPOSAL_CANCELLED",
          HTTP_STATUS.conflict,
          "proposal was cancelled and cannot be committed",
        );
      }
      // Idempotent forever: the stored result is the answer.
      if (record.result !== undefined) {
        return record.result;
      }
      // Single-flight: the sweeper and a manual confirm share one write.
      if (record.inFlight) {
        return record.inFlight;
      }
      if (now() >= record.expiresAtMs) {
        record.status = "expired";
        throw new ActionStateError(
          "PROPOSAL_EXPIRED",
          HTTP_STATUS.gone,
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
          HTTP_STATUS.gone,
          "proposal has expired",
        );
      }
      if (record.status === "committed") {
        throw new ActionStateError(
          "PROPOSAL_COMMITTED",
          HTTP_STATUS.conflict,
          "proposal is already committed",
        );
      }
      if (record.inFlight) {
        throw new ActionStateError(
          "PROPOSAL_COMMITTED",
          HTTP_STATUS.conflict,
          "proposal commit is already in progress",
        );
      }
      record.status = "cancelled";
      return { id: record.id, status: "cancelled" as const };
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
