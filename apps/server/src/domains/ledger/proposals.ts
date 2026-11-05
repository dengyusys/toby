/**
 * Ledger adapter over the shared actions kernel, immediate tier only
 * (docs/decisions/write-confirmation-tiers.md): the entry batch executes
 * transactionally at once, the kernel journals a born-confirmed record
 * with a revert window, and this adapter views both through the ledger's
 * HTTP contract shapes.
 */

import {
  createActionRegistry,
  type ActionRecord,
} from "../../infrastructure/actions-kernel/registry.ts";
import type {
  LedgerEntry,
  LedgerReceiptView,
  LedgerRevertResult,
} from "./types.ts";

/** Performs the actual transactional write for one batch. */
export type ProposalWriter = (entries: readonly LedgerEntry[]) => Promise<{
  written: number;
  transaction_ids: readonly number[];
}>;

/** The kernel-level journal entry for one landed batch. */
export interface LedgerBatchOutcome {
  readonly written: number;
  readonly transaction_ids: readonly number[];
  readonly committed_at: string;
}

export interface ProposalRegistryDeps {
  now: () => number;
  revertWindowMs?: number;
  retentionMs?: number;
}

export interface ProposalRegistry {
  /** Run the batch now; the returned receipt is born confirmed. */
  execute(
    id: string,
    entries: readonly LedgerEntry[],
    writer: ProposalWriter,
  ): Promise<LedgerReceiptView>;
  /** Apply the batch's before-snapshot inside the revert window. */
  revert(
    id: string,
    compensator: (outcome: LedgerBatchOutcome) => Promise<void>,
  ): Promise<LedgerRevertResult>;
  /** Prune records past their retention horizon. */
  sweep(): void;
}

type KernelRecord = ActionRecord<readonly LedgerEntry[], LedgerBatchOutcome>;

function toView(record: KernelRecord): LedgerReceiptView {
  // Born confirmed: the outcome exists from the moment of journalling,
  // so the fallbacks below only satisfy the optional-field checker.
  const outcome = record.result;
  return {
    proposal_id: record.id,
    status: record.status === "reverted" ? "reverted" : "committed",
    created_at: new Date(record.createdAtMs).toISOString(),
    committed_at:
      outcome?.committed_at ?? new Date(record.createdAtMs).toISOString(),
    revert_until: new Date(
      record.revertUntilMs ?? record.createdAtMs,
    ).toISOString(),
    ...(record.revertedAtMs
      ? { reverted_at: new Date(record.revertedAtMs).toISOString() }
      : {}),
    written: outcome?.written ?? 0,
    transaction_ids: outcome?.transaction_ids ?? [],
    entries: record.payload,
  };
}

export function createProposalRegistry(
  deps: ProposalRegistryDeps,
): ProposalRegistry {
  const kernel = createActionRegistry<
    readonly LedgerEntry[],
    LedgerBatchOutcome
  >(deps);
  return {
    async execute(id, entries, writer) {
      await kernel.execute(id, entries, async (batch) => {
        const { written, transaction_ids } = await writer(batch);
        return {
          written,
          transaction_ids,
          committed_at: new Date(deps.now()).toISOString(),
        };
      });
      const record = kernel.get(id);
      if (!record) {
        // Unreachable: execute() above just journalled this id.
        throw new Error(`journal lost record ${id} immediately after write`);
      }
      return toView(record);
    },

    async revert(id, compensator) {
      const outcome = await kernel.revert(id, async (_entries, result) =>
        compensator(result),
      );
      return {
        proposal_id: outcome.id,
        status: outcome.status,
        reverted_at: new Date(outcome.revertedAtMs).toISOString(),
      };
    },

    sweep() {
      kernel.sweep();
    },
  };
}
