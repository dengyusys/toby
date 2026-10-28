/**
 * Ledger adapter over the shared actions kernel: the ledger's proposal
 * state machine is the kernel instantiated with this domain's entry batch
 * as the payload and its commit result as the outcome, viewed through the
 * ledger's HTTP contract shapes.
 */

import {
  createActionRegistry,
  type ActionRecord,
} from "../../infrastructure/actions-kernel/registry.ts";
import type {
  LedgerCancelResult,
  LedgerCommitResult,
  LedgerEntry,
  LedgerProposalView,
} from "./types.ts";

/** Performs the actual transactional write for a proposal batch. */
export type ProposalWriter = (entries: readonly LedgerEntry[]) => Promise<{
  written: number;
  transaction_ids: readonly number[];
}>;

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

type KernelRecord = ActionRecord<readonly LedgerEntry[], LedgerCommitResult>;

function toView(record: KernelRecord): LedgerProposalView {
  return {
    proposal_id: record.id,
    status: record.status,
    created_at: new Date(record.createdAtMs).toISOString(),
    auto_write_at: new Date(record.autoWriteAtMs).toISOString(),
    expires_at: new Date(record.expiresAtMs).toISOString(),
    entries: record.payload,
  };
}

export function createProposalRegistry(
  deps: ProposalRegistryDeps,
): ProposalRegistry {
  const kernel = createActionRegistry<
    readonly LedgerEntry[],
    LedgerCommitResult
  >(deps);
  return {
    add(id, entries) {
      return toView(kernel.add(id, entries));
    },
    get(id) {
      const record = kernel.get(id);
      return record ? toView(record) : undefined;
    },
    async commit(id, writer) {
      return kernel.commit(id, async (entries) => {
        const { written, transaction_ids } = await writer(entries);
        return {
          proposal_id: id,
          status: "committed",
          written,
          transaction_ids,
          committed_at: new Date(deps.now()).toISOString(),
        };
      });
    },
    async cancel(id) {
      const cancelled = await kernel.cancel(id);
      return { proposal_id: cancelled.id, status: cancelled.status };
    },
    dueForAutoWrite() {
      return kernel.dueForAutoWrite();
    },
    sweep() {
      kernel.sweep();
    },
  };
}
