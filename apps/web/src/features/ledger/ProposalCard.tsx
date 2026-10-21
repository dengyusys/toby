/**
 * Proposal confirmation card (提案确认): the parsed entries with the
 * multi-entry total row, the auto-write countdown text, the terminal
 * states (已确认写入 / 已取消), and the 确认记入 / 取消 / 知道了 buttons.
 * The commit and cancel mutations live in LedgerPage; their pending and
 * error flags plus the callbacks arrive as props.
 */

import type { LedgerProposalView } from "@toby/contract";
import {
  describeError,
  formatCents,
  formatCountdown,
  primaryButtonClass,
  secondaryButtonClass,
  type ProposalOutcome,
} from "./ledger-view.ts";

interface ProposalCardProps {
  proposal: LedgerProposalView;
  outcome: ProposalOutcome | null;
  autoWriteInMs: number;
  commitPending: boolean;
  commitError: Error | null;
  cancelPending: boolean;
  onCommit: (proposalId: string) => void;
  onCancel: (proposalId: string) => void;
  onDismiss: () => void;
}

export function ProposalCard({
  proposal,
  outcome,
  autoWriteInMs,
  commitPending,
  commitError,
  cancelPending,
  onCommit,
  onCancel,
  onDismiss,
}: ProposalCardProps) {
  const proposalEntries = proposal.entries;
  const proposalTotalCents = proposalEntries.reduce(
    (sum, entry) =>
      sum + (entry.type === "income" ? entry.amount : -entry.amount),
    0,
  );

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">提案确认</h2>
        {outcome === null && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatCountdown(autoWriteInMs)} 后自动记入
          </p>
        )}
        {outcome === "committed" && (
          <p className="text-sm font-medium text-primary">已确认写入</p>
        )}
        {outcome === "cancelled" && (
          <p className="text-sm text-muted-foreground">已取消,未写入</p>
        )}
      </div>
      <ul className="mt-3 divide-y">
        {proposalEntries.map((entry, index) => (
          <li
            key={`${entry.date}-${index}`}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div>
              <p className="text-sm">
                {entry.date} · {entry.type === "expense" ? "支出" : "收入"}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.category} · {entry.account}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>
            <p
              className={`text-sm font-medium tabular-nums ${entry.type === "income" ? "text-primary" : ""}`}
            >
              {entry.type === "income" ? "+" : "-"}¥{formatCents(entry.amount)}
            </p>
          </li>
        ))}
      </ul>
      {proposalEntries.length > 1 && (
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          共 {proposalEntries.length} 笔 · 合计{" "}
          {proposalTotalCents < 0 ? "-" : ""}¥
          {formatCents(Math.abs(proposalTotalCents))}
        </p>
      )}
      {outcome === null ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={commitPending}
            onClick={() => onCommit(proposal.proposal_id)}
            className={primaryButtonClass}
          >
            {commitPending ? "记入中…" : "确认记入"}
          </button>
          <button
            type="button"
            disabled={cancelPending}
            onClick={() => onCancel(proposal.proposal_id)}
            className={secondaryButtonClass}
          >
            取消
          </button>
          {commitError && (
            <p className="text-sm text-destructive">
              {describeError(commitError)}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={onDismiss}
            className={secondaryButtonClass}
          >
            知道了
          </button>
        </div>
      )}
    </section>
  );
}
