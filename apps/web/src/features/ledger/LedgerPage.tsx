/**
 * Ledger route ("/ledger"): the replicated ai-steward calendar area — the
 * month grid plus the day panel. Recording happens in the chat on "/"; the
 * calendar state (shown month follows arrived data, placeholder data keeps
 * the previous view) lives here and stays the only calendar-side file
 * importing @tanstack/react-query.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LedgerTransactionRow } from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";
import { LedgerDayPanel } from "./LedgerDayPanel.tsx";
import { MonthLedger } from "./MonthLedger.tsx";
import { describeError, todayLocal } from "./ledger-view.ts";

export function LedgerPage() {
  // The requested month; the shown month follows arrived data (placeholder
  // data keeps the previous month's full view while fetching).
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthsQuery = useQuery({
    queryKey: ["ledger", "months"],
    queryFn: () => ledgerClient.listMonths(),
  });
  const monthQuery = useQuery({
    queryKey: ["ledger", "month", currentMonth],
    queryFn: () => ledgerClient.monthReport(currentMonth as string),
    enabled: currentMonth !== null,
    placeholderData: keepPreviousData,
  });

  const months = monthsQuery.data ?? [];
  const data = monthQuery.data ?? null;
  const shownMonth = data?.month ?? null;

  // Initial month: the latest month with records; an empty ledger falls
  // back to the current calendar month (chosen once, never re-raced).
  useEffect(() => {
    if (currentMonth === null && monthsQuery.data) {
      setCurrentMonth(monthsQuery.data[0] ?? fallbackMonth());
    }
  }, [currentMonth, monthsQuery.data]);

  // Default selected date: recomputed on month change (today when it falls
  // in the month, else the latest transaction's date, else the 1st);
  // placeholder data never participates, so background refreshes of the
  // same month do not disturb the selection.
  const settledData = monthQuery.isPlaceholderData ? null : data;
  useEffect(() => {
    if (!shownMonth || !settledData) {
      return;
    }
    setSelectedDate((previous) =>
      previous?.startsWith(`${shownMonth}-`)
        ? previous
        : chooseInitialDate(shownMonth, settledData.transactions),
    );
  }, [shownMonth, settledData]);

  const calendarError =
    monthsQuery.error ?? (data ? null : monthQuery.error) ?? null;
  const dayTransactions =
    settledData?.transactions.filter(
      (transaction) => transaction.date === selectedDate,
    ) ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        {calendarError ? (
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="text-13 leading-normal text-muted-foreground">
              无法显示账目:{describeError(calendarError)}
            </p>
          </div>
        ) : (
          <div className="grid w-full min-w-0 flex-1 items-start gap-4 max-[1100px]:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_336px]">
            <MonthLedger
              months={months}
              currentMonth={shownMonth ?? fallbackMonth()}
              data={settledData}
              loading={!data}
              onNavigate={setCurrentMonth}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
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

/** Empty-ledger fallback: the current local month (the server answers an
 * empty report rather than an error). */
function fallbackMonth(): string {
  return todayLocal().slice(0, 7);
}

/** Default date for a freshly opened month: today when it falls inside,
 * else the month's latest transaction date, else the 1st. */
function chooseInitialDate(
  month: string,
  transactions: LedgerTransactionRow[],
): string {
  const today = todayLocal();
  if (today.startsWith(month)) {
    return today;
  }
  const dates = transactions.map((transaction) => transaction.date).sort();
  return dates[dates.length - 1] ?? `${month}-01`;
}
