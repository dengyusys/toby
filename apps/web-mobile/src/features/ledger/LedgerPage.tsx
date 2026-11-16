/**
 * Ledger route ("/ledger", mobile): the replicated ai-steward calendar
 * area — the month grid plus the day panel. Recording happens in the chat
 * on "/"; the calendar state now lives in the useLedgerCalendar hook
 * (src/features/ledger/ledger-hooks.ts). Mobile owns its own layout and styles — nothing
 * is shared with the PC app.
 */

import { useLedgerCalendar } from "./ledger-hooks.ts";
import { LedgerDayPanel } from "./LedgerDayPanel.tsx";
import { MonthLedger } from "./MonthLedger.tsx";
import { describeError } from "./ledger-view.ts";

export function LedgerPage() {
  const {
    months,
    settledData,
    displayMonth,
    loading,
    navigate,
    selectedDate,
    select,
    calendarError,
    dayTransactions,
  } = useLedgerCalendar();

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {calendarError ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="text-sm leading-normal text-muted-foreground">
              无法显示账目:{describeError(calendarError)}
            </p>
          </div>
        ) : (
          <div className="grid w-full min-w-0 flex-1 items-start gap-4 max-[1100px]:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_336px]">
            <MonthLedger
              months={months}
              currentMonth={displayMonth}
              data={settledData}
              loading={loading}
              onNavigate={navigate}
              selectedDate={selectedDate}
              onSelect={select}
            />
            <LedgerDayPanel
              date={selectedDate}
              transactions={dayTransactions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
