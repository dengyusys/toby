/**
 * Selected-day panel: per-row edit (one transactional PATCH) and delete
 * (inline two-step confirm), owned by useLedgerDayWrites.
 */

import type { LedgerTransactionRow } from "@toby/contract";
import { useLedgerDayWrites } from "./ledger-hooks.ts";
import { Button } from "@/components/ui/button.tsx";
import { formatCents, weekdayOf } from "./ledger-view.ts";

interface LedgerDayPanelProps {
  date: string | null;
  transactions: LedgerTransactionRow[];
}

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground/40";

const LABEL_CLASS = "flex flex-col gap-1 text-xs text-faint";

export function LedgerDayPanel({ date, transactions }: LedgerDayPanelProps) {
  const {
    confirmingId,
    deleteError,
    askDelete,
    cancelDelete,
    confirmDelete,
    deletePending,
    editingId,
    draft,
    editError,
    startEdit,
    cancelEdit,
    update,
    saveEdit,
    savePending,
  } = useLedgerDayWrites();

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
        <span className="rounded-sm bg-surface-hover px-1.75 py-px text-xs leading-relaxed text-subtle">
          {weekday}
        </span>
      </div>

      {transactions.length === 0 ? (
        <p className="py-9 text-center text-xs text-faint">当日无收支</p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-col">
            {transactions.map((transaction, index) =>
              editingId === transaction.id && draft !== null ? (
                <div
                  key={transaction.id}
                  className={`py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
                  aria-label={`编辑 ${transaction.category}`}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <label className={LABEL_CLASS}>
                      日期
                      <input
                        type="date"
                        value={draft.date}
                        onChange={(event) => update("date", event.target.value)}
                        className={INPUT_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      类型
                      <select
                        value={draft.type}
                        onChange={(event) => update("type", event.target.value)}
                        className={INPUT_CLASS}
                      >
                        <option value="expense">支出</option>
                        <option value="income">收入</option>
                      </select>
                    </label>
                    <label className={LABEL_CLASS}>
                      分类
                      <input
                        value={draft.category}
                        onChange={(event) =>
                          update("category", event.target.value)
                        }
                        className={INPUT_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      金额
                      <input
                        inputMode="decimal"
                        value={draft.amount}
                        onChange={(event) =>
                          update("amount", event.target.value)
                        }
                        className={`${INPUT_CLASS} font-mono tabular-nums`}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      备注
                      <input
                        value={draft.note}
                        onChange={(event) => update("note", event.target.value)}
                        className={INPUT_CLASS}
                      />
                    </label>
                  </div>
                  {editError && (
                    <p className="mt-1.5 text-xs text-danger">{editError}</p>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={cancelEdit}
                      className="text-muted-foreground"
                    >
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      disabled={savePending}
                      onClick={() => saveEdit(transaction.id)}
                    >
                      {savePending ? "保存中…" : "保存"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={transaction.id}
                  className={`flex items-baseline justify-between gap-3 py-2.5 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {transaction.category}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-2.5">
                    <span
                      className={`font-mono text-sm font-semibold tabular-nums ${transaction.type === "expense" ? "text-danger" : "text-success"}`}
                    >
                      {transaction.type === "expense" ? "−" : "+"}
                      {formatCents(transaction.amount)}
                    </span>
                    {confirmingId === transaction.id ? (
                      <span className="flex items-baseline gap-1.5">
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          disabled={deletePending}
                          onClick={() => confirmDelete(transaction.id)}
                        >
                          {deletePending ? "删除中…" : "确认删除"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={cancelDelete}
                          className="text-muted-foreground"
                        >
                          取消
                        </Button>
                      </span>
                    ) : (
                      <span className="flex items-baseline gap-2.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`编辑 ${transaction.category} ¥${formatCents(transaction.amount)}`}
                          onClick={() => startEdit(transaction)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`删除 ${transaction.category} ¥${formatCents(transaction.amount)}`}
                          onClick={() => askDelete(transaction.id)}
                          className="text-muted-foreground hover:text-danger"
                        >
                          删除
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
          <div className="mt-2 flex justify-between gap-3 border-t border-border pt-2.5 font-mono text-xs text-muted-foreground tabular-nums">
            <span>
              支出 <span className="text-danger">¥{formatCents(expense)}</span>
              {" · "}收入{" "}
              <span className="text-success">¥{formatCents(income)}</span>
            </span>
            <span>{transactions.length} 笔</span>
          </div>
          {deleteError && (
            <p className="mt-1.5 text-xs text-danger">{deleteError}</p>
          )}
        </>
      )}
    </aside>
  );
}
