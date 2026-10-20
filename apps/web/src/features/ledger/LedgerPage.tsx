/**
 * Ledger page: record an entry through the proposal pipeline (sentence or
 * form → proposal card → confirm or cancel), then browse a month calendar
 * with per-day subtotals and a selected-day detail panel. Every write is
 * server-mediated; the page only renders proposals.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type LedgerEntryInput,
  type LedgerProposalView,
  type LedgerTransactionRow,
} from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";

interface EntryFormState {
  date: string;
  type: "expense" | "income";
  category: string;
  account: string;
  amount: string;
  note: string;
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayLocal(): string {
  return toLocalIso(new Date());
}

function initialForm(): EntryFormState {
  return {
    date: todayLocal(),
    type: "expense",
    category: "",
    account: "",
    amount: "",
    note: "",
  };
}

/** Cents are the wire format; the page shows decimal yuan. */
function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"] as const;
const WEEKDAY_HEADERS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function weekdayOf(date: string): string {
  return WEEKDAY_NAMES[new Date(`${date}T00:00:00`).getDay()]!;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year!, monthNumber! - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

interface DayCell {
  date: string;
  day: number;
  inMonth: boolean;
  expenseCents: number;
  incomeCents: number;
}

/** Six-week Monday-first grid; day subtotals filled from the month rows. */
function buildMonthGrid(
  month: string,
  transactions: readonly LedgerTransactionRow[],
): DayCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year!, monthNumber! - 1, 1);
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - ((first.getDay() + 6) % 7));
  const cells: DayCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    cells.push({
      date: toLocalIso(cursor),
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === monthNumber! - 1,
      expenseCents: 0,
      incomeCents: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  for (const transaction of transactions) {
    const cell = byDate.get(transaction.date);
    if (!cell) {
      continue;
    }
    if (transaction.type === "income") {
      cell.incomeCents += transaction.amount;
    } else {
      cell.expenseCents += transaction.amount;
    }
  }
  return cells;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_ENTRY":
        return `录入有误:${error.message}`;
      case "INVALID_MONTH":
        return "月份参数不正确";
      case "PROPOSAL_CANCELLED":
        return "提案已取消,无法记入";
      case "PROPOSAL_COMMITTED":
        return "提案已记入";
      case "PROPOSAL_EXPIRED":
        return "提案已过期,请重新录入";
      case "PROPOSAL_NOT_FOUND":
        return "提案不存在或已被清理";
      case "AI_UNAVAILABLE":
        return "AI 未配置:需要在服务端设置 TOBY_AI_API_KEY 与 TOBY_AI_MODEL";
      case "AI_REQUEST_FAILED":
        return "AI 服务出错,请稍后再试";
      default:
        return error.message;
    }
  }
  return "请求失败,请稍后重试";
}

const inputClass =
  "mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const primaryButtonClass =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const secondaryButtonClass =
  "inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50";

type ProposalOutcome = "committed" | "cancelled";

export function LedgerPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EntryFormState>(initialForm);
  const [sentence, setSentence] = useState("");
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [proposal, setProposal] = useState<LedgerProposalView | null>(null);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const autoFiredFor = useRef<string | null>(null);

  const monthsQuery = useQuery({
    queryKey: ["ledger", "months"],
    queryFn: () => ledgerClient.listMonths(),
  });
  const effectiveMonth = selectedMonth || monthsQuery.data?.[0] || "";
  const reportQuery = useQuery({
    queryKey: ["ledger", "month", effectiveMonth],
    queryFn: () => ledgerClient.monthReport(effectiveMonth),
    enabled: effectiveMonth !== "",
  });

  // One tick per second while a proposal awaits its auto-write moment.
  useEffect(() => {
    if (!proposal || outcome) {
      return;
    }
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [proposal, outcome]);

  function refreshLedger(): void {
    void queryClient.invalidateQueries({ queryKey: ["ledger"] });
  }

  const commitMutation = useMutation({
    mutationFn: (id: string) => ledgerClient.commitProposal(id),
    onSuccess: () => {
      setOutcome("committed");
      refreshLedger();
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => ledgerClient.cancelProposal(id),
    onSuccess: () => {
      setOutcome("cancelled");
      refreshLedger();
    },
    onError: (error) => {
      // The server auto-writes at the 30-second mark; a late cancel just
      // means the entries already landed — treat it as committed.
      if (error instanceof ApiError && error.code === "PROPOSAL_COMMITTED") {
        setOutcome("committed");
        refreshLedger();
      }
    },
  });
  const createMutation = useMutation({
    mutationFn: (entry: LedgerEntryInput) =>
      ledgerClient.createStructuredProposal(entry),
    onSuccess: (view) => {
      setProposal(view);
      setOutcome(null);
      autoFiredFor.current = null;
      setForm(initialForm());
    },
  });
  const sentenceMutation = useMutation({
    mutationFn: (text: string) => ledgerClient.createTextProposal(text),
    onSuccess: (result) => {
      setSentence("");
      if ("question" in result) {
        setFollowUp(result.question);
        return;
      }
      setFollowUp(null);
      setProposal(result);
      setOutcome(null);
      autoFiredFor.current = null;
    },
  });

  // Countdown to the server's auto-write moment; hitting zero commits here
  // too — the endpoint is idempotent, so this races the sweeper safely.
  const autoWriteInMs = proposal
    ? Date.parse(proposal.auto_write_at) - nowTick
    : Number.POSITIVE_INFINITY;
  const commitMutate = commitMutation.mutate;
  useEffect(() => {
    if (!proposal || outcome || autoWriteInMs > 0) {
      return;
    }
    if (autoFiredFor.current === proposal.proposal_id) {
      return;
    }
    autoFiredFor.current = proposal.proposal_id;
    commitMutate(proposal.proposal_id);
  }, [autoWriteInMs, proposal, outcome, commitMutate]);

  function updateField<K extends keyof EntryFormState>(
    field: K,
    value: EntryFormState[K],
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submitEntry(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate({
      date: form.date,
      type: form.type,
      category: form.category.trim(),
      account: form.account.trim(),
      amount: form.amount.trim(),
      note: form.note.trim(),
    });
  }

  const report = reportQuery.data;
  const monthCells = useMemo(
    () => (report ? buildMonthGrid(report.month, report.transactions) : []),
    [report],
  );

  // Default selection follows the data: the month's latest transaction,
  // then today if it falls inside the month, otherwise nothing.
  useEffect(() => {
    if (!report) {
      return;
    }
    setSelectedDate((current) => {
      if (current && report.transactions.some((tx) => tx.date === current)) {
        return current;
      }
      const latest = report.transactions.reduce<string | null>(
        (max, tx) => (max === null || tx.date > max ? tx.date : max),
        null,
      );
      if (latest) {
        return latest;
      }
      return todayLocal().startsWith(report.month) ? todayLocal() : null;
    });
  }, [report]);

  const selectedDayRows = useMemo(
    () =>
      report && selectedDate
        ? report.transactions.filter((tx) => tx.date === selectedDate)
        : [],
    [report, selectedDate],
  );

  /** Arrow-key navigation across this month's day cells. */
  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const focusable = monthCells.filter((cell) => cell.inMonth);
    const index = focusable.findIndex((cell) => cell.date === selectedDate);
    if (index < 0) {
      return;
    }
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -index,
      End: focusable.length - 1 - index,
    };
    const delta = deltas[event.key];
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const next =
      focusable[Math.min(focusable.length - 1, Math.max(0, index + delta))];
    if (!next) {
      return;
    }
    setSelectedDate(next.date);
    document
      .querySelector<HTMLButtonElement>(`[data-day="${next.date}"]`)
      ?.focus();
  }

  const proposalEntries = proposal?.entries ?? [];
  const proposalTotalCents = proposalEntries.reduce(
    (sum, entry) =>
      sum + (entry.type === "income" ? entry.amount : -entry.amount),
    0,
  );

  return (
    <div className="flex flex-col gap-6 py-8">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-medium">记一笔</h2>
        <form className="mt-4" onSubmit={submitEntry}>
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-medium text-muted-foreground">
                一句话记账
              </span>
              <input
                placeholder="如:昨天午饭花了 35"
                value={sentence}
                onChange={(event) => setSentence(event.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="button"
              disabled={sentenceMutation.isPending || sentence.trim() === ""}
              onClick={() => sentenceMutation.mutate(sentence.trim())}
              className={`${primaryButtonClass} shrink-0`}
            >
              {sentenceMutation.isPending ? "解析中…" : "解析"}
            </button>
          </div>
          {sentenceMutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {describeError(sentenceMutation.error)}
            </p>
          )}
          {followUp && (
            <p className="mt-2 text-sm text-muted-foreground">
              补充一下:{followUp}
            </p>
          )}
          <div className="mt-4 grid gap-x-4 gap-y-3 border-t pt-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                日期
              </span>
              <input
                type="date"
                required
                value={form.date}
                onChange={(event) => updateField("date", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                类型
              </span>
              <select
                value={form.type}
                onChange={(event) =>
                  updateField(
                    "type",
                    event.target.value === "income" ? "income" : "expense",
                  )
                }
                className={inputClass}
              >
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                分类
              </span>
              <input
                required
                maxLength={24}
                placeholder="餐饮"
                value={form.category}
                onChange={(event) =>
                  updateField("category", event.target.value)
                }
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                账户
              </span>
              <input
                maxLength={24}
                placeholder="现金 / 微信(可留空)"
                value={form.account}
                onChange={(event) => updateField("account", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                金额
              </span>
              <input
                required
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => updateField("amount", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                备注
              </span>
              <input
                maxLength={200}
                placeholder="可选"
                value={form.note}
                onChange={(event) => updateField("note", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className={primaryButtonClass}
            >
              {createMutation.isPending ? "生成中…" : "生成提案"}
            </button>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {describeError(createMutation.error)}
              </p>
            )}
          </div>
        </form>
      </section>

      {proposal && (
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
                  {entry.type === "income" ? "+" : "-"}¥
                  {formatCents(entry.amount)}
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
                disabled={commitMutation.isPending}
                onClick={() => commitMutation.mutate(proposal.proposal_id)}
                className={primaryButtonClass}
              >
                {commitMutation.isPending ? "记入中…" : "确认记入"}
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(proposal.proposal_id)}
                className={secondaryButtonClass}
              >
                取消
              </button>
              {commitMutation.isError && (
                <p className="text-sm text-destructive">
                  {describeError(commitMutation.error)}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setProposal(null);
                  setOutcome(null);
                }}
                className={secondaryButtonClass}
              >
                知道了
              </button>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">月度账本</h2>
          <div className="flex items-center gap-2">
            {monthsQuery.data && monthsQuery.data.length > 0 && (
              <select
                value={effectiveMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {monthsQuery.data.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {monthsQuery.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {describeError(monthsQuery.error)}
          </p>
        ) : !monthsQuery.data || monthsQuery.data.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            还没有记录,记第一笔吧。
          </p>
        ) : reportQuery.isError ? (
          <p className="mt-3 text-sm text-destructive">
            {describeError(reportQuery.error)}
          </p>
        ) : !report ? (
          <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">收入</p>
                <p className="mt-1 font-medium tabular-nums">
                  ¥{formatCents(report.income_total)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">支出</p>
                <p className="mt-1 font-medium tabular-nums">
                  ¥{formatCents(report.expense_total)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">结余</p>
                <p className="mt-1 font-medium tabular-nums">
                  ¥{formatCents(report.income_total - report.expense_total)}
                </p>
              </div>
            </div>

            {report.categories.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {report.categories.map((category) => (
                  <span
                    key={`${category.type}-${category.category}`}
                    className="rounded-full bg-muted/60 px-2.5 py-1 text-xs"
                  >
                    {category.type === "expense" ? "支" : "收"} ·{" "}
                    {category.category} ¥{formatCents(category.total)}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="上一月"
                  onClick={() => setSelectedMonth(shiftMonth(report.month, -1))}
                  className="inline-flex size-8 items-center justify-center rounded-lg border text-sm hover:bg-accent"
                >
                  ‹
                </button>
                <span className="text-sm font-medium tabular-nums">
                  {report.month}
                </span>
                <button
                  type="button"
                  aria-label="下一月"
                  onClick={() => setSelectedMonth(shiftMonth(report.month, 1))}
                  className="inline-flex size-8 items-center justify-center rounded-lg border text-sm hover:bg-accent"
                >
                  ›
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 text-center text-xs text-muted-foreground">
                {WEEKDAY_HEADERS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div
                role="grid"
                aria-label={`${report.month} 月历`}
                onKeyDown={handleGridKeyDown}
                className="mt-1 grid grid-cols-7 gap-1"
              >
                {monthCells.map((cell) => {
                  const isToday = cell.date === todayLocal();
                  const isSelected = cell.date === selectedDate;
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      data-day={cell.date}
                      aria-label={cell.date}
                      aria-selected={isSelected}
                      disabled={!cell.inMonth}
                      onClick={() => setSelectedDate(cell.date)}
                      className={`flex min-h-14 flex-col items-center gap-0.5 rounded-lg border p-1 text-center ${
                        cell.inMonth ? "hover:bg-accent" : "opacity-30"
                      } ${isSelected ? "ring-2 ring-ring" : ""}`}
                    >
                      <span
                        className={`text-xs tabular-nums ${
                          isToday
                            ? "rounded-full bg-primary px-1.5 text-primary-foreground"
                            : ""
                        }`}
                      >
                        {cell.day}
                      </span>
                      {cell.expenseCents > 0 && (
                        <span className="text-[10px] leading-tight text-destructive tabular-nums">
                          支 {formatCents(cell.expenseCents)}
                        </span>
                      )}
                      {cell.incomeCents > 0 && (
                        <span className="text-[10px] leading-tight text-primary tabular-nums">
                          收 {formatCents(cell.incomeCents)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedDate ? (
                <div className="mt-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">
                      {Number(selectedDate.slice(5, 7))}月
                      {Number(selectedDate.slice(8, 10))}日 · 周
                      {weekdayOf(selectedDate)}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {selectedDayRows.length} 笔
                    </span>
                  </div>
                  {selectedDayRows.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      当日无收支
                    </p>
                  ) : (
                    <>
                      <ul className="mt-2 divide-y">
                        {selectedDayRows.map((transaction) => (
                          <li
                            key={transaction.id}
                            className="flex items-center justify-between gap-3 py-2.5"
                          >
                            <div>
                              <p className="text-sm">
                                {transaction.category}
                                {transaction.note
                                  ? ` · ${transaction.note}`
                                  : ""}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {transaction.account}
                              </p>
                            </div>
                            <p
                              className={`text-sm font-medium tabular-nums ${transaction.type === "income" ? "text-primary" : ""}`}
                            >
                              {transaction.type === "income" ? "+" : "-"}¥
                              {formatCents(transaction.amount)}
                            </p>
                          </li>
                        ))}
                      </ul>
                      <DayFooter rows={selectedDayRows} />
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  点击日期查看当日明细
                </p>
              )}
            </div>
          </>
        )}
      </section>
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
