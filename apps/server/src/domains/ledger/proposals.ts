/**
 * In-memory proposal registry: the ledger's proposal state machine. A
 * proposal is pending for a 30-second confirmation window — not cancelled
 * by then means the server auto-writes it — with a 10-minute TTL as the
 * hard expiry backstop. Commit is single-flight (the sweeper and a manual
 * confirm share one write) and idempotent forever after: the first result
 * is stored and echoed. Records are pruned an hour after expiry, so memory
 * stays bounded; after that a commit reports plain 404.
 */

import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import type {
  LedgerCancelResult,
  LedgerCommitResult,
  LedgerEntry,
  LedgerProposalStatus,
  LedgerProposalView,
} from "./types.ts";

export const DEFAULT_AUTO_WRITE_DELAY_MS = 30_000;
export const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_RETENTION_MS = 60 * 60_000;

/** Domain-shaped error recognized by the unified HTTP error boundary. */
export class ProposalStateError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ProposalStateError";
    this.code = code;
    this.status = status;
  }
}

/** Performs the actual transactional write for a proposal batch. */
export type ProposalWriter = (entries: readonly LedgerEntry[]) => Promise<{
  written: number;
  transaction_ids: readonly number[];
}>;

interface ProposalRecord {
  readonly id: string;
  readonly entries: readonly LedgerEntry[];
  status: LedgerProposalStatus;
  readonly createdAtMs: number;
  readonly autoWriteAtMs: number;
  readonly expiresAtMs: number;
  commitResult?: LedgerCommitResult;
  inFlight?: Promise<LedgerCommitResult>;
}

export interface ProposalRegistryDeps {
  now: () => number;
  autoWriteDelayMs?: number;
  ttlMs?: number;
  retentionMs?: number;
}

export interface ProposalRegistry {
  add(id: string, entries: readonly LedgerEntry[]): LedgerProposalView;
  get(id: string): LedgerProposalView | undefined;
  commit(id: string, writer: ProposalWriter): Promise<LedgerCommitResult>;
  cancel(id: string): Promise<LedgerCancelResult>;
  /** Pending proposals past their auto-write moment, not yet expired. */
  dueForAutoWrite(): readonly string[];
  /** Mark expired; prune records past their retention horizon. */
  sweep(): void;
}

function toView(record: ProposalRecord): LedgerProposalView {
  return {
    proposal_id: record.id,
    status: record.status,
    created_at: new Date(record.createdAtMs).toISOString(),
    auto_write_at: new Date(record.autoWriteAtMs).toISOString(),
    expires_at: new Date(record.expiresAtMs).toISOString(),
    entries: record.entries,
  };
}

export function createProposalRegistry(
  deps: ProposalRegistryDeps,
): ProposalRegistry {
  const now = deps.now;
  const autoWriteDelayMs = deps.autoWriteDelayMs ?? DEFAULT_AUTO_WRITE_DELAY_MS;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const retentionMs = deps.retentionMs ?? DEFAULT_RETENTION_MS;
  const records = new Map<string, ProposalRecord>();

  function requireRecord(id: string): ProposalRecord {
    const record = records.get(id);
    if (!record) {
      throw new ProposalStateError(
        "PROPOSAL_NOT_FOUND",
        HTTP_STATUS.notFound,
        "proposal not found",
      );
    }
    return record;
  }

  return {
    add(id, entries) {
      const nowMs = now();
      const record: ProposalRecord = {
        id,
        entries,
        status: "pending",
        createdAtMs: nowMs,
        autoWriteAtMs: nowMs + autoWriteDelayMs,
        expiresAtMs: nowMs + ttlMs,
      };
      records.set(id, record);
      return toView(record);
    },

    get(id) {
      const record = records.get(id);
      return record ? toView(record) : undefined;
    },

    async commit(id, writer) {
      const record = requireRecord(id);
      if (record.status === "expired") {
        throw new ProposalStateError(
          "PROPOSAL_EXPIRED",
          HTTP_STATUS.gone,
          "proposal has expired",
        );
      }
      if (record.status === "cancelled") {
        throw new ProposalStateError(
          "PROPOSAL_CANCELLED",
          HTTP_STATUS.conflict,
          "proposal was cancelled and cannot be committed",
        );
      }
      // Idempotent forever: the stored result is the answer.
      if (record.commitResult) {
        return Promise.resolve(record.commitResult);
      }
      // Single-flight: the sweeper and a manual confirm share one write.
      if (record.inFlight) {
        return record.inFlight;
      }
      if (now() >= record.expiresAtMs) {
        record.status = "expired";
        throw new ProposalStateError(
          "PROPOSAL_EXPIRED",
          HTTP_STATUS.gone,
          "proposal has expired",
        );
      }
      const attempt = (async () => {
        try {
          const { written, transaction_ids } = await writer(record.entries);
          const result: LedgerCommitResult = {
            proposal_id: record.id,
            status: "committed",
            written,
            transaction_ids,
            committed_at: new Date(now()).toISOString(),
          };
          record.status = "committed";
          record.commitResult = result;
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
        throw new ProposalStateError(
          "PROPOSAL_EXPIRED",
          HTTP_STATUS.gone,
          "proposal has expired",
        );
      }
      if (record.status === "committed") {
        throw new ProposalStateError(
          "PROPOSAL_COMMITTED",
          HTTP_STATUS.conflict,
          "proposal is already committed",
        );
      }
      if (record.inFlight) {
        throw new ProposalStateError(
          "PROPOSAL_COMMITTED",
          HTTP_STATUS.conflict,
          "proposal commit is already in progress",
        );
      }
      record.status = "cancelled";
      return { proposal_id: record.id, status: "cancelled" };
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
      for (const record of records.values()) {
        if (record.status === "pending" && nowMs >= record.expiresAtMs) {
          record.status = "expired";
        }
        if (nowMs >= record.expiresAtMs + retentionMs) {
          records.delete(record.id);
        }
      }
    },
  };
}
