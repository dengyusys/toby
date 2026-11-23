/**
 * Ledger hooks, a per-app copy by design. useLedgerCalendar derives the shown
 * month from arrived data; useLedgerDayWrites owns the two money writes.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { LedgerEntryPatch, LedgerTransactionRow } from "@toby/contract";
import { ledgerQueryKeys } from "./ledger-keys.ts";
import { ledgerClient } from "@/lib/api.ts";
import { describeError, formatCents, todayLocal } from "./ledger-view.ts";

/** One editing row's draft: plain strings, checked on save. */
export interface EditDraft {
  date: string;
  type: string;
  category: string;
  amount: string;
  note: string;
}

function draftOf(row: LedgerTransactionRow): EditDraft {
  return {
    date: row.date,
    type: row.type,
    category: row.category,
    amount: formatCents(row.amount),
    note: row.note,
  };
}

/** Same money shape the server accepts: non-negative, two decimals max. */
const AMOUNT_INPUT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function useLedgerCalendar() {
  // The month the user navigated to; null until the first navigation. The
  // shown month follows arrived data (placeholder data keeps the previous
  // month's full view while fetching).
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  // The date the user picked; the effective selection derives from it below.
  const [userSelectedDate, setUserSelectedDate] = useState<string | null>(null);

  const monthsQuery = useQuery({
    queryKey: ledgerQueryKeys.months,
    queryFn: () => ledgerClient.listMonths(),
  });
  // Initial month: the latest month with records; an empty ledger falls back
  // to the current calendar month. Derived at render (no effect, no extra
  // render pass) — until the user navigates, the shown month follows the
  // arrived months list.
  const monthsData = monthsQuery.data;
  const month =
    currentMonth ??
    (monthsData === undefined ? null : (monthsData[0] ?? fallbackMonth()));
  const monthQuery = useQuery({
    queryKey: ledgerQueryKeys.month(month),
    queryFn: () => ledgerClient.monthReport(month as string),
    enabled: month !== null,
    placeholderData: keepPreviousData,
  });

  const months = monthsData ?? [];
  const data = monthQuery.data ?? null;
  const shownMonth = data?.month ?? null;
  // Placeholder data never participates, so background refreshes of the
  // same month do not disturb the selection.
  const settledData = monthQuery.isPlaceholderData ? null : data;

  // Default selected date for a freshly shown month: today when it falls in
  // the month, else the month's latest transaction date, else the 1st.
  const initialDate = useMemo(
    () =>
      shownMonth !== null && settledData !== null
        ? chooseInitialDate(shownMonth, settledData.transactions)
        : null,
    [shownMonth, settledData],
  );
  // Effective selection: a picked date survives while it belongs to the
  // shown month (placeholder data keeps the previous month, so picks also
  // survive in-flight month fetches); otherwise the month's default.
  const selectedDate =
    userSelectedDate !== null &&
    shownMonth !== null &&
    userSelectedDate.startsWith(`${shownMonth}-`)
      ? userSelectedDate
      : initialDate;

  const calendarError =
    monthsQuery.error ?? (data ? null : monthQuery.error) ?? null;
  const dayTransactions =
    settledData?.transactions.filter(
      (transaction) => transaction.date === selectedDate,
    ) ?? [];

  const displayMonth = shownMonth ?? fallbackMonth();
  const loading = !data;

  return {
    months,
    settledData,
    displayMonth,
    loading,
    navigate: setCurrentMonth,
    selectedDate,
    select: setUserSelectedDate,
    calendarError,
    dayTransactions,
  };
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

// Switching days folds any half-armed confirm, open edit, and stale
// errors: the day panel is keyed by the selected date in LedgerPage, so a
// day switch remounts the panel (and this hook's state) from scratch.
export function useLedgerDayWrites() {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ledgerClient.deleteTransaction(id),
    onSuccess: () => {
      setConfirmingId(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ledgerQueryKeys.all });
    },
    onError: (error) => {
      setConfirmingId(null);
      setDeleteError(describeError(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: number; patch: LedgerEntryPatch }) =>
      ledgerClient.updateTransaction(input.id, input.patch),
    onSuccess: () => {
      setEditingId(null);
      setDraft(null);
      setEditError(null);
      void queryClient.invalidateQueries({ queryKey: ledgerQueryKeys.all });
    },
    onError: (error) => {
      setEditError(describeError(error));
    },
  });

  function startEdit(row: LedgerTransactionRow) {
    setConfirmingId(null);
    setDeleteError(null);
    setEditingId(row.id);
    setDraft(draftOf(row));
    setEditError(null);
  }

  function update<Field extends keyof EditDraft>(field: Field, value: string) {
    setDraft((current) =>
      current === null ? current : { ...current, [field]: value },
    );
  }

  function saveEdit(id: number) {
    if (draft === null) {
      return;
    }
    const category = draft.category.trim();
    const amount = draft.amount.trim();
    if (draft.date === "") {
      setEditError("日期不能为空");
      return;
    }
    if (category === "") {
      setEditError("分类不能为空");
      return;
    }
    if (!AMOUNT_INPUT_PATTERN.test(amount)) {
      setEditError("金额需为非负数字,最多两位小数");
      return;
    }
    const patch: LedgerEntryPatch = {
      date: draft.date,
      type: draft.type === "income" ? "income" : "expense",
      category,
      amount,
      note: draft.note.trim(),
    };
    updateMutation.mutate({ id, patch });
  }

  // The 删除 button folds any open edit, then arms its row's confirm.
  function askDelete(id: number) {
    setEditingId(null);
    setDraft(null);
    setConfirmingId(id);
  }

  function cancelDelete() {
    setConfirmingId(null);
  }

  function confirmDelete(id: number) {
    deleteMutation.mutate(id);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditError(null);
  }

  return {
    confirmingId,
    deleteError,
    askDelete,
    cancelDelete,
    confirmDelete,
    deletePending: deleteMutation.isPending,
    editingId,
    draft,
    editError,
    startEdit,
    cancelEdit,
    update,
    saveEdit,
    savePending: updateMutation.isPending,
  };
}
