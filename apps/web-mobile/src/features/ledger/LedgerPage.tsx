/**
 * Ledger page shell (mobile): owns the form / sentence / proposal state,
 * the react-query hooks, the proposal-pipeline mutations (including the
 * countdown auto-commit effect), and the month and selection state feeding
 * the calendar (the ai-steward calendar-page flow: the shown month follows
 * arrived data, placeholder data keeps the previous view). Rendering is
 * delegated to the EntryForm, ProposalCard, MonthLedger, and
 * LedgerDayPanel components; this stays the only file in the feature that
 * imports @tanstack/react-query. Mobile owns its own layout and styles —
 * nothing is shared with the PC app.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type LedgerEntryInput,
  type LedgerProposalView,
  type LedgerTransactionRow,
} from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";
import { EntryForm } from "./EntryForm.tsx";
import { LedgerDayPanel } from "./LedgerDayPanel.tsx";
import { MonthLedger } from "./MonthLedger.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import {
  describeError,
  initialForm,
  todayLocal,
  type EntryFormState,
  type ProposalOutcome,
} from "./ledger-view.ts";

export function LedgerPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EntryFormState>(initialForm);
  const [sentence, setSentence] = useState("");
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [proposal, setProposal] = useState<LedgerProposalView | null>(null);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(null);
  // The requested month; the shown month follows arrived data (placeholder
  // data keeps the previous month's full view while fetching).
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const autoFiredFor = useRef<string | null>(null);

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

  const calendarError =
    monthsQuery.error ?? (data ? null : monthQuery.error) ?? null;
  const dayTransactions =
    settledData?.transactions.filter(
      (transaction) => transaction.date === selectedDate,
    ) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <EntryForm
        sentence={sentence}
        onSentenceChange={setSentence}
        onParseSentence={(text) => sentenceMutation.mutate(text)}
        sentencePending={sentenceMutation.isPending}
        sentenceError={sentenceMutation.error}
        followUp={followUp}
        form={form}
        onFieldChange={updateField}
        onSubmitEntry={submitEntry}
        createPending={createMutation.isPending}
        createError={createMutation.error}
      />

      {proposal && (
        <ProposalCard
          proposal={proposal}
          outcome={outcome}
          autoWriteInMs={autoWriteInMs}
          commitPending={commitMutation.isPending}
          commitError={commitMutation.error}
          cancelPending={cancelMutation.isPending}
          onCommit={(proposalId) => commitMutation.mutate(proposalId)}
          onCancel={(proposalId) => cancelMutation.mutate(proposalId)}
          onDismiss={() => {
            setProposal(null);
            setOutcome(null);
          }}
        />
      )}

      {calendarError ? (
        // First load failed: the calendar area turns into an error card;
        // the form above stays usable for recording.
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
          <LedgerDayPanel date={selectedDate} transactions={dayTransactions} />
        </div>
      )}
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
