/**
 * Selected-day panel (replicated from the ai-steward design, plus a toby
 * delete affordance): the mono date heading with its weekday chip, the
 * day's transaction list (category, note · account, signed amount), and
 * the expense/income footer totals. Each row carries a delete button with
 * an inline two-step confirm — the sole user-initiated direct write —
 * owned here as a mutation that invalidates the ledger queries. Sits
 * beside the month grid (sticky on wide viewports).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LedgerTransactionRow } from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";
import { describeError, formatCents, weekdayOf } from "./ledger-view.ts";

interface LedgerDayPanelProps {
  date: string | null;
  transactions: LedgerTransactionRow[];
}

export function LedgerDayPanel({ date, transactions }: LedgerDayPanelProps) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Switching days folds any half-armed confirm and stale error.
  useEffect(() => {
    setConfirmingId(null);
    setDeleteError(null);
  }, [date]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ledgerClient.deleteTransaction(id),
    onSuccess: () => {
      setConfirmingId(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (error) => {
      setConfirmingId(null);
      setDeleteError(describeError(error));
    },
  });

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
                <div className="flex shrink-0 items-baseline gap-2.5">
                  <span
                    className={`font-mono text-13 font-semibold tabular-nums ${transaction.type === "expense" ? "text-danger" : "text-success"}`}
                  >
                    {transaction.type === "expense" ? "−" : "+"}
                    {formatCents(transaction.amount)}
                  </span>
                  {confirmingId === transaction.id ? (
                    <span className="flex items-baseline gap-1.5">
                      <button
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(transaction.id)}
                        className="cursor-pointer rounded-sm bg-destructive px-2 py-0.5 text-11 text-destructive-foreground transition-opacity duration-150 hover:opacity-85 disabled:cursor-default disabled:opacity-50"
                      >
                        {deleteMutation.isPending ? "删除中…" : "确认删除"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="cursor-pointer text-11 text-faint transition-colors duration-150 hover:text-foreground"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`删除 ${transaction.category} ¥${formatCents(transaction.amount)}`}
                      onClick={() => setConfirmingId(transaction.id)}
                      className="cursor-pointer text-11 text-faint transition-colors duration-150 hover:text-danger"
                    >
                      删除
                    </button>
                  )}
                </div>
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
          {deleteError && (
            <p className="mt-1.5 text-11 text-danger">{deleteError}</p>
          )}
        </>
      )}
    </aside>
  );
}
