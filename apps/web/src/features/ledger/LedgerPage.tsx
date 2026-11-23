/**
 * Ledger route: the month grid plus the day panel; recording happens in the
 * chat. Calendar state lives in useLedgerCalendar.
 */

import { LedgerDayPanel } from "./LedgerDayPanel.tsx";
import { MonthLedger } from "./MonthLedger.tsx";
import { describeError } from "./ledger-view.ts";
import { useLedgerCalendar } from "./ledger-hooks.ts";

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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
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
            {/* Keyed by the selected date: switching days remounts the
                panel, folding any half-armed confirm, open edit, and stale
                errors (the hook's state resets with the remount). */}
            <LedgerDayPanel
              key={selectedDate ?? "none"}
              date={selectedDate}
              transactions={dayTransactions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
