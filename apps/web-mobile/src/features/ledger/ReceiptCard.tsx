/**
 * Receipt card (回执卡, mobile): a write that has already landed — the
 * batch was recorded the moment the sentence was sent. Shows the entries
 * with the multi-entry total row. Recovery is writing again or backup. Nothing is shared with the PC
 * app.
 */

import type { LedgerReceiptView } from "@toby/contract";
import { formatCents } from "./ledger-view.ts";

interface ReceiptCardProps {
  receipt: LedgerReceiptView;
}

export function ReceiptCard({ receipt }: ReceiptCardProps) {
  const entries = receipt.entries;
  const totalCents = entries.reduce(
    (sum, entry) =>
      sum + (entry.type === "income" ? entry.amount : -entry.amount),
    0,
  );

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-medium">已记入</h2>
      <ul className="mt-2 divide-y">
        {entries.map((entry, index) => (
          <li
            key={`${entry.date}-${index}`}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="text-sm">
                {entry.date} · {entry.type === "expense" ? "支出" : "收入"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.category} · {entry.account}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>
            <p
              className={`text-base font-medium tabular-nums ${entry.type === "income" ? "text-primary" : ""}`}
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
    </section>
  );
}
