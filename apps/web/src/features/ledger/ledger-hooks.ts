/**
 * Ledger hooks — a per-app copy mirrored in the sibling app by design
 * (dual-app split); useLedgerCalendar owns the calendar state (shown month
 * follows arrived data, placeholder keeps the previous view),
 * useLedgerDayWrites owns the two user-initiated direct money writes
 * (PATCH/delete with inline two-step confirm).
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  // The requested month; the shown month follows arrived data (placeholder
  // data keeps the previous month's full view while fetching).
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthsQuery = useQuery({
    queryKey: ledgerQueryKeys.months,
    queryFn: () => ledgerClient.listMonths(),
  });
  const monthQuery = useQuery({
    queryKey: ledgerQueryKeys.month(currentMonth),
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

  const displayMonth = shownMonth ?? fallbackMonth();
  const loading = !data;

  return {
    months,
    settledData,
    displayMonth,
    loading,
    navigate: setCurrentMonth,
    selectedDate,
    select: setSelectedDate,
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

export function useLedgerDayWrites(date: string | null) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Switching days folds any half-armed confirm, open edit, and stale errors.
  useEffect(() => {
    setConfirmingId(null);
    setDeleteError(null);
    setEditingId(null);
    setDraft(null);
    setEditError(null);
  }, [date]);

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
