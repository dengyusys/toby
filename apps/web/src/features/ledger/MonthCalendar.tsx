/**
 * Month calendar: the ‹ › month navigation row, the Monday-first weekday
 * header, and the six-week day grid (today pill, selection ring, per-day
 * 支/收 subtotals). The PC grid keeps its arrow-key navigation — selection
 * and focus move across the month's day cells. Month and selection state
 * live in LedgerPage and arrive as props.
 */

import {
  formatCents,
  shiftMonth,
  todayLocal,
  WEEKDAY_HEADERS,
  type DayCell,
} from "./ledger-view.ts";

interface MonthCalendarProps {
  month: string;
  cells: readonly DayCell[];
  selectedDate: string | null;
  onSelectMonth: (month: string) => void;
  onSelectDate: (date: string) => void;
}

export function MonthCalendar({
  month,
  cells,
  selectedDate,
  onSelectMonth,
  onSelectDate,
}: MonthCalendarProps) {
  /** Arrow-key navigation across this month's day cells. */
  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const focusable = cells.filter((cell) => cell.inMonth);
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
    onSelectDate(next.date);
    document
      .querySelector<HTMLButtonElement>(`[data-day="${next.date}"]`)
      ?.focus();
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="上一月"
          onClick={() => onSelectMonth(shiftMonth(month, -1))}
          className="inline-flex size-8 items-center justify-center rounded-lg border text-sm hover:bg-accent"
        >
          ‹
        </button>
        <span className="text-sm font-medium tabular-nums">{month}</span>
        <button
          type="button"
          aria-label="下一月"
          onClick={() => onSelectMonth(shiftMonth(month, 1))}
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
        aria-label={`${month} 月历`}
        onKeyDown={handleGridKeyDown}
        className="mt-1 grid grid-cols-7 gap-1"
      >
        {cells.map((cell) => {
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
              onClick={() => onSelectDate(cell.date)}
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
    </>
  );
}
