/**
 * Ledger page shell: owns the form / sentence / proposal state, the
 * react-query hooks, the proposal-pipeline mutations (including the
 * countdown auto-commit effect), and the month and selection state feeding
 * the calendar. Rendering is delegated to the EntryForm, ProposalCard,
 * MonthCalendar, and DayDetail components; this stays the only file in the
 * feature that imports @tanstack/react-query.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type LedgerEntryInput,
  type LedgerProposalView,
} from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";
import { DayDetail } from "./DayDetail.tsx";
import { EntryForm } from "./EntryForm.tsx";
import { MonthCalendar } from "./MonthCalendar.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import {
  buildMonthGrid,
  describeError,
  formatCents,
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

  return (
    <div className="flex flex-col gap-6 py-8">
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
              <MonthCalendar
                month={report.month}
                cells={monthCells}
                selectedDate={selectedDate}
                onSelectMonth={setSelectedMonth}
                onSelectDate={setSelectedDate}
              />
              {selectedDate ? (
                <DayDetail date={selectedDate} rows={selectedDayRows} />
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
