/**
 * Month calendar (mobile): the ‹ › month navigation row, the Monday-first
 * weekday header, and the six-week day grid (today pill, selection ring,
 * per-day 支/收 subtotals). Mobile keeps the simpler touch grid — no
 * keyboard navigation. Month and selection state live in LedgerPage and
 * arrive as props. Nothing is shared with the PC app.
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
  return (
    <>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="上一月"
          onClick={() => onSelectMonth(shiftMonth(month, -1))}
          className="inline-flex size-10 items-center justify-center rounded-lg border text-sm active:bg-accent"
        >
          ‹
        </button>
        <span className="text-sm font-medium tabular-nums">{month}</span>
        <button
          type="button"
          aria-label="下一月"
          onClick={() => onSelectMonth(shiftMonth(month, 1))}
          className="inline-flex size-10 items-center justify-center rounded-lg border text-sm active:bg-accent"
        >
          ›
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-xs text-muted-foreground">
        {WEEKDAY_HEADERS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const isToday = cell.date === todayLocal();
          const isSelected = cell.date === selectedDate;
          return (
            <button
              key={cell.date}
              type="button"
              aria-label={cell.date}
              aria-selected={isSelected}
              disabled={!cell.inMonth}
              onClick={() => onSelectDate(cell.date)}
              className={`flex min-h-16 flex-col items-center gap-0.5 rounded-lg border p-1 text-center ${
                cell.inMonth ? "active:bg-accent" : "opacity-30"
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
