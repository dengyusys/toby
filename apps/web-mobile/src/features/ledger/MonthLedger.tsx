/**
 * Month ledger grid (replicated from the ai-steward design): the ‹ ›
 * month pager with the running expense/income/count summary, the
 * Sunday-first weekday header, and the day grid with per-day 支/收
 * subtotals. Cells are buttons with arrow-key navigation; the target
 * month is only reachable while it has records (months list). Month and
 * selection state live in LedgerPage and arrive as props.
 */

import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LedgerMonthReport } from "@toby/contract";
import { formatCents, monthLabel, todayLocal } from "./ledger-view.ts";

interface MonthLedgerProps {
  months: string[];
  currentMonth: string;
  data: LedgerMonthReport | null;
  loading: boolean;
  onNavigate: (month: string) => void;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}

interface DayTotals {
  expense: number;
  income: number;
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function MonthLedger({
  months,
  currentMonth,
  data,
  loading,
  onNavigate,
  selectedDate,
  onSelect,
}: MonthLedgerProps) {
  // Pager targets follow calendar time: left = previous (earlier) month,
  // right = next (newer) month; a target without records disables the
  // button (months is the set of months that have data).
  const monthShift = (delta: number): string | undefined => {
    const [year = 0, month = 0] = currentMonth.split("-").map(Number);
    const shifted = new Date(year, month - 1 + delta, 1);
    const target = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
    return months.includes(target) ? target : undefined;
  };
  const previousMonth = monthShift(-1);
  const nextMonth = monthShift(1);

  // Per-day totals aggregated from the month's transactions (integer
  // cents, no float drift).
  const dailyTotals = useMemo(() => {
    const map = new Map<string, DayTotals>();
    for (const transaction of data?.transactions ?? []) {
      const entry = map.get(transaction.date) ?? { expense: 0, income: 0 };
      if (transaction.type === "expense") {
        entry.expense += transaction.amount;
      } else {
        entry.income += transaction.amount;
      }
      map.set(transaction.date, entry);
    }
    return map;
  }, [data]);

  // Grid geometry: first weekday, days in month, rows padded to full weeks.
  const [year = 0, monthNumber = 0] = currentMonth.split("-").map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const rowCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const today = todayLocal();
  // Arrow keys move focus between this month's day cells; with nothing
  // selected the 1st acts as the tab stop.
  const cellRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const tabStopDate = selectedDate ?? `${currentMonth}-01`;

  const focusDate = (date: string) => {
    cellRefs.current.get(date)?.focus();
    onSelect(date);
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentDate = (event.target as HTMLElement).dataset.date;
    if (!currentDate) return;
    const day = Number(currentDate.slice(-2));
    let targetDay: number;
    switch (event.key) {
      case "ArrowRight":
        targetDay = Math.min(day + 1, daysInMonth);
        break;
      case "ArrowLeft":
        targetDay = Math.max(day - 1, 1);
        break;
      case "ArrowDown":
        targetDay = Math.min(day + 7, daysInMonth);
        break;
      case "ArrowUp":
        targetDay = Math.max(day - 7, 1);
        break;
      case "Home":
        targetDay = 1;
        break;
      case "End":
        targetDay = daysInMonth;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusDate(`${currentMonth}-${String(targetDay).padStart(2, "0")}`);
  };

  const cells: ReactNode[] = [];
  for (let index = 0; index < rowCount * 7; index += 1) {
    const dayNumber = index - firstWeekday + 1;
    const isLastColumn = index % 7 === 6;
    const isLastRow = index >= rowCount * 7 - 7;

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cells.push(
        <div
          key={`empty-${index}`}
          className={`min-h-[76px] border-r border-b border-border bg-inset/40 max-[767px]:min-h-[56px] max-[380px]:min-h-[46px] ${isLastColumn ? "border-r-0" : ""} ${isLastRow ? "border-b-0" : ""}`}
          aria-hidden="true"
        />,
      );
      continue;
    }

    const date = `${currentMonth}-${String(dayNumber).padStart(2, "0")}`;
    const totals = dailyTotals.get(date);
    const isToday = date === today;
    const isSelected = date === selectedDate;

    // The selection ring is an inset box-shadow (compositor friendly) over
    // an accent-soft fill; hover layers only on unselected cells.
    const cellClass = [
      "relative flex min-h-[76px] cursor-pointer flex-col border-r border-b border-border bg-surface p-2 text-left transition-colors duration-150 max-[767px]:min-h-[56px] max-[767px]:p-1.5 max-[380px]:min-h-[46px]",
      isLastColumn && "border-r-0",
      isLastRow && "border-b-0",
      isSelected
        ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--primary)]"
        : "hover:bg-surface-hover",
    ]
      .filter(Boolean)
      .join(" ");

    cells.push(
      <button
        key={date}
        type="button"
        className={cellClass}
        role="gridcell"
        aria-label={`${date}${totals ? `，支出 ${formatCents(totals.expense)}，收入 ${formatCents(totals.income)}` : "，无收支"}`}
        aria-selected={isSelected}
        tabIndex={date === tabStopDate ? 0 : -1}
        data-date={date}
        ref={(element) => {
          if (element) cellRefs.current.set(date, element);
          else cellRefs.current.delete(date);
        }}
        onClick={() => onSelect(date)}
      >
        <span
          className={`self-end font-mono text-xs leading-none tabular-nums ${
            isToday
              ? "rounded-full bg-primary px-1.5 py-0.5 font-bold text-primary-foreground"
              : isSelected
                ? "font-bold text-primary"
                : "text-subtle"
          }`}
        >
          {dayNumber}
        </span>
        <div className="mt-auto flex flex-col gap-0.5 pt-1">
          {totals && totals.expense > 0 && (
            <span className="font-mono text-11 text-danger tabular-nums max-[380px]:text-[10px]">
              支 {formatCents(totals.expense)}
            </span>
          )}
          {totals && totals.income > 0 && (
            <span className="font-mono text-11 text-success tabular-nums max-[380px]:text-[10px]">
              收 {formatCents(totals.income)}
            </span>
          )}
        </div>
      </button>,
    );
  }

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface"
      aria-label="月度账单"
    >
      {/* Header: the month pager plus the running month summary. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-hover px-4 py-2.5 max-[767px]:px-3.5">
        <div className="flex items-center gap-1" aria-label="月份导航">
          <button
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-subtle transition-colors duration-150 hover:bg-accent-soft hover:text-foreground disabled:cursor-default disabled:opacity-30"
            type="button"
            aria-label="上一月"
            disabled={previousMonth === undefined}
            onClick={() => previousMonth && onNavigate(previousMonth)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[96px] px-1 text-center font-serif text-15 font-semibold tracking-tight tabular-nums">
            {monthLabel(currentMonth)}
          </span>
          <button
            className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-subtle transition-colors duration-150 hover:bg-accent-soft hover:text-foreground disabled:cursor-default disabled:opacity-30"
            type="button"
            aria-label="下一月"
            disabled={nextMonth === undefined}
            onClick={() => nextMonth && onNavigate(nextMonth)}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {data && (
          <span className="ml-auto font-mono text-11 text-faint tabular-nums">
            支出{" "}
            <span className="text-danger">
              ¥{formatCents(data.expense_total)}
            </span>
            {" · "}收入{" "}
            <span className="text-success">
              ¥{formatCents(data.income_total)}
            </span>
            {" · "}
            {data.transactions.length} 笔
          </span>
        )}
      </div>

      {loading && !data ? (
        <p className="p-9 text-center text-13 leading-relaxed text-faint">
          正在加载…
        </p>
      ) : (
        <>
          {/* Weekday row: the weekend columns carry the primary color. */}
          <div
            className="grid grid-cols-7 border-b border-border text-center text-11 font-semibold text-faint [&>span:first-child]:text-primary [&>span:last-child]:text-primary"
            aria-hidden="true"
          >
            <span className="py-2">日</span>
            <span className="py-2">一</span>
            <span className="py-2">二</span>
            <span className="py-2">三</span>
            <span className="py-2">四</span>
            <span className="py-2">五</span>
            <span className="py-2">六</span>
          </div>
          <div
            role="grid"
            aria-label={`${monthLabel(currentMonth)}收支月历`}
            onKeyDown={handleGridKeyDown}
          >
            {Array.from({ length: rowCount }, (_, row) => (
              <div className="grid grid-cols-7" role="row" key={row}>
                {cells.slice(row * 7, row * 7 + 7)}
              </div>
            ))}
          </div>
          {data && data.transactions.length === 0 && (
            <p className="py-6 text-center text-13 leading-relaxed text-faint">
              本月暂无账目。点击日期查看详情，或用上方表单记一笔。
            </p>
          )}
        </>
      )}
    </section>
  );
}
