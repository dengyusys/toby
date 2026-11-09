/**
 * Receipt card (回执卡): a write that has already landed — the batch was
 * recorded the moment the sentence was sent. Shows the entries with the
 * multi-entry total, the revert-window countdown while it is open, the
 * 已撤销 terminal state, and nothing once the window closes (a plain
 * receipt). The revert mutation lives in LedgerChat; its pending and error
 * flags plus the callback arrive as props.
 */

import type { LedgerReceiptView } from "@toby/contract";
import { describeError, formatCents, formatCountdown } from "./ledger-view.ts";
import { Button } from "@/components/ui/button.tsx";

interface ReceiptCardProps {
  receipt: LedgerReceiptView;
  nowMs: number;
  revertPending: boolean;
  revertError: Error | null;
  onRevert: (proposalId: string) => void;
  onDismiss: () => void;
}

export function ReceiptCard({
  receipt,
  nowMs,
  revertPending,
  revertError,
  onRevert,
  onDismiss,
}: ReceiptCardProps) {
  const entries = receipt.entries;
  const totalCents = entries.reduce(
    (sum, entry) =>
      sum + (entry.type === "income" ? entry.amount : -entry.amount),
    0,
  );
  const windowInMs = Date.parse(receipt.revert_until) - nowMs;
  const revertible = receipt.status === "committed" && windowInMs > 0;
  const reverted = receipt.status === "reverted";

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">已记入</h2>
        {revertible && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatCountdown(windowInMs)} 内可撤销
          </p>
        )}
        {reverted && <p className="text-sm text-muted-foreground">已撤销</p>}
      </div>
      <ul className="mt-3 divide-y">
        {entries.map((entry, index) => (
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
      {entries.length > 1 && (
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          共 {entries.length} 笔 · 合计 {totalCents < 0 ? "-" : ""}¥
          {formatCents(Math.abs(totalCents))}
        </p>
      )}
      {revertible ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={revertPending}
            onClick={() => onRevert(receipt.proposal_id)}
          >
            {revertPending ? "撤销中…" : "撤销"}
          </Button>
          {revertError && (
            <p className="text-sm text-destructive">
              {describeError(revertError)}
            </p>
          )}
        </div>
      ) : reverted ? (
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={onDismiss}>
            知道了
          </Button>
        </div>
      ) : null}
    </section>
  );
}
