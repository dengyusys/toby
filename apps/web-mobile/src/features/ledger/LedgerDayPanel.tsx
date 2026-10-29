/**
 * Selected-day panel (replicated from the ai-steward design): the mono
 * date heading with its weekday chip, the day's transaction list
 * (category, note · account, signed amount), and the expense/income
 * footer totals. Sits beside the month grid (sticky on wide viewports).
 */

import type { LedgerTransactionRow } from "@toby/contract";
import { formatCents, weekdayOf } from "./ledger-view.ts";

interface LedgerDayPanelProps {
  date: string | null;
  transactions: LedgerTransactionRow[];
}

export function LedgerDayPanel({ date, transactions }: LedgerDayPanelProps) {
  const weekday = date ? weekdayOf(date) : "";
  const expense = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const income = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return (
    <aside
      className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4.5 max-[767px]:p-3.5 lg:sticky lg:top-0"
      aria-live="polite"
      aria-label="当日账目"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg font-semibold tracking-tight tabular-nums">
          {date}
        </span>
        <span className="rounded-sm bg-surface-hover px-1.75 py-px text-11 leading-relaxed text-subtle">
          {weekday}
        </span>
      </div>

      {transactions.length === 0 ? (
        <p className="py-9 text-center text-xs text-faint">当日无收支</p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-col">
            {transactions.map((transaction, index) => (
              <div
                key={transaction.id}
                className={`flex items-baseline justify-between gap-3 py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-13 font-medium text-foreground">
                    {transaction.category}
                  </div>
                  {transaction.note && (
                    <div className="mt-0.5 text-xs text-faint [overflow-wrap:anywhere]">
                      {transaction.note}
                      {transaction.account !== "未关联" &&
                        ` · ${transaction.account}`}
                    </div>
                  )}
                </div>
                <span
                  className={`shrink-0 font-mono text-13 font-semibold tabular-nums ${transaction.type === "expense" ? "text-danger" : "text-success"}`}
                >
                  {transaction.type === "expense" ? "−" : "+"}
                  {formatCents(transaction.amount)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between gap-3 border-t border-border pt-2.5 font-mono text-11 text-faint tabular-nums">
            <span>
              支出 <span className="text-danger">¥{formatCents(expense)}</span>
              {" · "}收入{" "}
              <span className="text-success">¥{formatCents(income)}</span>
            </span>
            <span>{transactions.length} 笔</span>
          </div>
        </>
      )}
    </aside>
  );
}
