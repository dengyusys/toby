/**
 * Selected-day panel (mobile): the date heading with weekday and
 * transaction count, the day's transaction list, and the 支/收 footer
 * totals (DayFooter). Rendered below the calendar grid for the date the
 * user picked. Nothing is shared with the PC app.
 */

import type { LedgerTransactionRow } from "@toby/contract";
import { formatCents, weekdayOf } from "./ledger-view.ts";

interface DayDetailProps {
  date: string;
  rows: readonly LedgerTransactionRow[];
}

export function DayDetail({ date, rows }: DayDetailProps) {
  return (
    <div className="mt-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {Number(date.slice(5, 7))}月{Number(date.slice(8, 10))}日 · 周
          {weekdayOf(date)}
        </h3>
        <span className="text-xs text-muted-foreground">{rows.length} 笔</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">当日无收支</p>
      ) : (
        <>
          <ul className="mt-2 divide-y">
            {rows.map((transaction) => (
              <li
                key={transaction.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm">
                    {transaction.category}
                    {transaction.note ? ` · ${transaction.note}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {transaction.account}
                  </p>
                </div>
                <p
                  className={`text-base font-medium tabular-nums ${transaction.type === "income" ? "text-primary" : ""}`}
                >
                  {transaction.type === "income" ? "+" : "-"}¥
                  {formatCents(transaction.amount)}
                </p>
              </li>
            ))}
          </ul>
          <DayFooter rows={rows} />
        </>
      )}
    </div>
  );
}

function DayFooter({ rows }: { rows: readonly LedgerTransactionRow[] }) {
  const expense = rows
    .filter((row) => row.type === "expense")
    .reduce((sum, row) => sum + row.amount, 0);
  const income = rows
    .filter((row) => row.type === "income")
    .reduce((sum, row) => sum + row.amount, 0);
  return (
    <p className="mt-2 text-xs text-muted-foreground tabular-nums">
      支出 ¥{formatCents(expense)} · 收入 ¥{formatCents(income)}
    </p>
  );
}
