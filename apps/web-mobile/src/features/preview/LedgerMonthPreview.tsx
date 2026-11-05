/**
 * The ledger month preview (mobile copy): one month's report — totals,
 * category subtotals, and the transaction list — fed by the same month
 * endpoint the calendar page uses. Nothing is shared with the PC app.
 */

import { useQuery } from "@tanstack/react-query";
import { ledgerClient } from "@/lib/api.ts";
import { formatCents } from "@/features/ledger/ledger-view.ts";

export function LedgerMonthPreview({ month }: { month: string }) {
  const report = useQuery({
    queryKey: ["ledger", "month", month],
    queryFn: () => ledgerClient.monthReport(month),
  });

  if (report.isPending) {
    return <p className="px-4 py-4 text-sm text-muted-foreground">读取中…</p>;
  }
  if (report.isError) {
    return (
      <p className="px-4 py-4 text-sm text-destructive">读取失败,稍后再试</p>
    );
  }
  const data = report.data;
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">收入</p>
          <p className="mt-1 text-base font-medium tabular-nums text-primary">
            ¥{formatCents(data.income_total)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">支出</p>
          <p className="mt-1 text-base font-medium tabular-nums">
            ¥{formatCents(data.expense_total)}
          </p>
        </div>
      </div>
      {data.categories.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground">
            分类小计
          </h3>
          <ul className="mt-2 divide-y">
            {data.categories.map((category) => (
              <li
                key={`${category.type}-${category.category}`}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span>
                  {category.type === "income" ? "收" : "支"} ·{" "}
                  {category.category}
                </span>
                <span className="tabular-nums">
                  ¥{formatCents(category.total)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="text-xs font-medium text-muted-foreground">
          逐笔({data.transactions.length})
        </h3>
        <ul className="mt-2 divide-y">
          {data.transactions.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div>
                <p>{row.date}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.category} · {row.account}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </div>
              <p
                className={`tabular-nums ${row.type === "income" ? "text-primary" : ""}`}
              >
                {row.type === "income" ? "+" : "-"}¥{formatCents(row.amount)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
