/**
 * Conversational recording panel (mobile copy; chat-box form replicated
 * from the ai-steward chat design, ledger-scoped): a scrolling message
 * stream plus a bottom composer. One sentence per send — the server
 * answers with a proposal card, a clarifying question, or an error turn;
 * every pending proposal keeps its countdown and auto-write. A fragment
 * answering the pending question folds back onto the sentence that caused
 * it before dispatch, and sending tacitly commits pending proposals first
 * (both chat-domain rules, applied client-side here). History is
 * session-only — persisted conversations belong to the future chat domain
 * (docs/features/chat.md).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError, type LedgerProposalView } from "@toby/contract";
import { ledgerClient } from "@/lib/api.ts";
import { ProposalCard } from "./ProposalCard.tsx";
import { describeError, type ProposalOutcome } from "./ledger-view.ts";

type Turn =
  | { kind: "greeting"; id: number }
  | { kind: "user"; id: number; text: string }
  | { kind: "question"; id: number; text: string }
  | {
      kind: "proposal";
      id: number;
      proposal: LedgerProposalView;
      outcome: ProposalOutcome | null;
    }
  | { kind: "error"; id: number; text: string };

const GREETING =
  "说一句话就能记账，例如「昨天午饭花了 25」。不确定的地方我会追问。";

const MAX_INPUT_HEIGHT = 120;

export function LedgerChat() {
  const queryClient = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([{ kind: "greeting", id: 0 }]);
  const [draft, setDraft] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  // The sentence behind the pending follow-up question; the next send —
  // usually a bare fragment like "今天呀" — folds onto it before dispatch.
  const [followUpBase, setFollowUpBase] = useState<string | null>(null);
  const nextId = useRef(1);
  const firedRef = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const pendingProposals = turns.filter(
    (turn): turn is Extract<Turn, { kind: "proposal" }> =>
      turn.kind === "proposal" && turn.outcome === null,
  );

  // One tick per second while any proposal awaits its auto-write moment.
  useEffect(() => {
    if (pendingProposals.length === 0) {
      return;
    }
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [pendingProposals.length]);

  // Keep the newest turn in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [turns]);

  function refreshLedger(): void {
    void queryClient.invalidateQueries({ queryKey: ["ledger"] });
  }

  function setOutcome(proposalId: string, outcome: ProposalOutcome): void {
    setTurns((current) =>
      current.map((turn) =>
        turn.kind === "proposal" && turn.proposal.proposal_id === proposalId
          ? { ...turn, outcome }
          : turn,
      ),
    );
  }

  const commitMutation = useMutation({
    mutationFn: (id: string) => ledgerClient.commitProposal(id),
    onSuccess: (result) => {
      setOutcome(result.proposal_id, "committed");
      refreshLedger();
    },
    onError: (error, id) => {
      // The server auto-writes at the 30-second mark; a late commit just
      // means the entries already landed — treat it as committed.
      if (error instanceof ApiError && error.code === "PROPOSAL_COMMITTED") {
        setOutcome(id, "committed");
        refreshLedger();
      }
      // Other failures leave the card pending: the countdown keeps
      // running and the server's own auto-write settles it.
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => ledgerClient.cancelProposal(id),
    onSuccess: (result) => {
      setOutcome(result.proposal_id, "cancelled");
    },
  });

  // Send: the user turn lands immediately (the typed fragment only — the
  // folded outbound sentence travels as mutation data); pending proposals
  // are committed first (tacit approval, oldest first); the reply becomes
  // a question, proposal, or error turn.
  const sendMutation = useMutation({
    mutationFn: (variables: { outbound: string; display: string }) =>
      ledgerClient.createTextProposal(variables.outbound),
    onMutate: (variables) => {
      for (const pending of pendingProposals) {
        if (!firedRef.current.has(pending.proposal.proposal_id)) {
          firedRef.current.add(pending.proposal.proposal_id);
          commitMutation.mutate(pending.proposal.proposal_id);
        }
      }
      setTurns((current) => [
        ...current,
        { kind: "user", id: nextId.current++, text: variables.display },
      ]);
      setDraft("");
    },
    onSuccess: (result, variables) => {
      setTurns((current) => [
        ...current,
        "question" in result
          ? { kind: "question", id: nextId.current++, text: result.question }
          : {
              kind: "proposal",
              id: nextId.current++,
              proposal: result,
              outcome: null,
            },
      ]);
      // A question keeps the (possibly already folded) sentence as the
      // folding base for its answer; anything else ends the follow-up.
      setFollowUpBase("question" in result ? variables.outbound : null);
    },
    onError: (error) => {
      setTurns((current) => [
        ...current,
        { kind: "error", id: nextId.current++, text: describeError(error) },
      ]);
      setFollowUpBase(null);
    },
  });
  const sendPending = sendMutation.isPending;

  /** Send a typed sentence, folding it onto the follow-up base if set. */
  function send(text: string): void {
    const outbound = followUpBase ? `${followUpBase}，${text}` : text;
    sendMutation.mutate({ outbound, display: text });
  }

  // Countdown to each proposal's auto-write moment; hitting zero commits
  // here too — the endpoint is idempotent, so this races the sweeper
  // safely. Fired ids are remembered so a commit in flight is not doubled.
  useEffect(() => {
    for (const pending of pendingProposals) {
      const id = pending.proposal.proposal_id;
      if (firedRef.current.has(id)) {
        continue;
      }
      if (Date.parse(pending.proposal.auto_write_at) - nowTick > 0) {
        continue;
      }
      firedRef.current.add(id);
      commitMutation.mutate(id);
    }
  });

  // Composer textarea auto-grows to MAX_INPUT_HEIGHT.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text && !sendPending) {
      send(text);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter breaks a line; an IME composition's Enter
    // must pass through (Chinese input relies on it).
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      const text = draft.trim();
      if (text && !sendPending) {
        send(text);
      }
    }
  }

  return (
    <section
      aria-label="对话记账"
      className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div
        ref={listRef}
        className="flex h-[300px] flex-col gap-3 overflow-y-auto p-3.5"
        aria-live="polite"
      >
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            nowTick={nowTick}
            commitPending={commitMutation.isPending}
            commitError={commitMutation.error}
            cancelPending={cancelMutation.isPending}
            onCommit={(id) => commitMutation.mutate(id)}
            onCancel={(id) => cancelMutation.mutate(id)}
            onDismiss={() =>
              setTurns((current) =>
                current.filter((item) => item.id !== turn.id),
              )
            }
          />
        ))}
        {sendPending && (
          <p className="px-1 text-xs text-muted-foreground">正在解析…</p>
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        aria-busy={sendPending}
        className="border-t p-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-background py-2 pr-2 pl-3.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="对话输入"
            placeholder="记一笔，例如：昨天午饭花了 25"
            className="max-h-[120px] min-h-[34px] flex-1 resize-none border-none bg-transparent py-1.5 text-base leading-relaxed outline-none"
          />
          <button
            type="submit"
            disabled={sendPending || draft.trim().length === 0}
            aria-label="发送"
            title="发送（Enter）"
            className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.92] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[15px]"
              aria-hidden="true"
            >
              <path d="m5 12 14-7-7 14-2.1-5.9L5 12Z" />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

interface TurnViewProps {
  turn: Turn;
  nowTick: number;
  commitPending: boolean;
  commitError: Error | null;
  cancelPending: boolean;
  onCommit: (proposalId: string) => void;
  onCancel: (proposalId: string) => void;
  onDismiss: () => void;
}

function TurnView({
  turn,
  nowTick,
  commitPending,
  commitError,
  cancelPending,
  onCommit,
  onCancel,
  onDismiss,
}: TurnViewProps) {
  if (turn.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-xl bg-accent-soft px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
          {turn.text}
        </div>
      </div>
    );
  }
  if (turn.kind === "greeting") {
    return (
      <div className="rounded-xl border bg-surface px-4 py-2.5 text-sm leading-relaxed text-muted-foreground">
        {GREETING}
      </div>
    );
  }
  if (turn.kind === "question") {
    return (
      <div className="rounded-xl border bg-surface px-4 py-2.5 text-sm leading-relaxed">
        {turn.text}
      </div>
    );
  }
  if (turn.kind === "error") {
    return (
      <div className="rounded-xl border bg-surface px-4 py-2.5 text-sm leading-relaxed text-destructive">
        {turn.text}
      </div>
    );
  }
  return (
    <ProposalCard
      proposal={turn.proposal}
      outcome={turn.outcome}
      autoWriteInMs={Date.parse(turn.proposal.auto_write_at) - nowTick}
      commitPending={commitPending}
      commitError={commitError}
      cancelPending={cancelPending}
      onCommit={onCommit}
      onCancel={onCancel}
      onDismiss={onDismiss}
    />
  );
}
