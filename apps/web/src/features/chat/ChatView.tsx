/**
 * The unified conversation (chat-box form): the persisted item stream —
 * restored on refresh — plus the bottom composer. One sentence per send;
 * the reply is an ordered stream of items (docs/features/chat.md):
 * transcript messages, the receipt card, notices, and inspect chips. The
 * receipt's revert window keeps its countdown; a revert reports the
 * card's final state back as display metadata.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatItem, ChatTurnView, LedgerReceiptView } from "@toby/contract";
import { chatClient, ledgerClient } from "@/lib/api.ts";
import { describeError } from "@/features/ledger/ledger-view.ts";
import { usePreview } from "@/features/preview/preview-context.tsx";
import { ItemView } from "./ItemView.tsx";

/** The empty-conversation hero headline, centered until the first send. */
const EMPTY_HEADLINE = "有什么我能帮你的吗？";

const MAX_INPUT_HEIGHT = 200;

/** Tool calls whose results this stream never delivered: in progress. */
function pendingToolCallIdsOf(turns: readonly ChatTurnView[]): Set<string> {
  const pending = new Set<string>();
  for (const turn of turns) {
    for (const item of turn.items) {
      if ("role" in item && item.role === "assistant") {
        for (const block of item.content) {
          if (block.type === "toolCall") {
            pending.add(block.id);
          }
        }
      }
    }
    for (const item of turn.items) {
      if ("role" in item && item.role === "toolResult") {
        pending.delete(item.toolCallId);
      }
    }
  }
  return pending;
}

/** Narrow an opaque card receipt to the ledger view this build renders. */
function ledgerReceiptOf(item: ChatItem): LedgerReceiptView | undefined {
  if (!("type" in item) || item.type !== "proposal_card") {
    return undefined;
  }
  return item.domain === "ledger"
    ? (item.receipt as LedgerReceiptView)
    : undefined;
}

/** Receipt cards with a live revert window drive the countdown ticker. */
function hasOpenWindow(turns: readonly ChatTurnView[], nowMs: number): boolean {
  return turns.some((turn) =>
    turn.items.some((item) => {
      const receipt = ledgerReceiptOf(item);
      return (
        receipt !== undefined &&
        receipt.status === "committed" &&
        Date.parse(receipt.revert_until) > nowMs
      );
    }),
  );
}

export function ChatView() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [errorText, setErrorText] = useState<string | null>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const history = useQuery({
    queryKey: ["chat", "sessions"],
    queryFn: () => chatClient.listSessions(),
  });
  const sessionId = history.data?.[0]?.session_id;
  const messagesKey = ["chat", "messages", sessionId] as const;
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => chatClient.listMessages(sessionId!, { limit: 100 }),
    enabled: sessionId !== undefined,
  });
  const turns = messages.data?.turns ?? [];

  const preview = usePreview();

  // Turns restored on load never push cards (old news); each turn that
  // lands afterwards offers its inspect links once.
  const seenTurns = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seenTurns.current === null) {
      // The baseline is the restored page — initialize once it has
      // actually loaded, so history never counts as "new".
      if (!messages.isSuccess) {
        return;
      }
      seenTurns.current = new Set(turns.map((turn) => turn.turn_id));
      return;
    }
    for (const turn of turns) {
      if (seenTurns.current.has(turn.turn_id)) {
        continue;
      }
      seenTurns.current.add(turn.turn_id);
      for (const item of turn.items) {
        if ("type" in item && item.type === "inspect_link") {
          preview.offer({ target: item.target, label: item.label });
        }
      }
    }
  }, [turns, preview, messages.isSuccess]);

  // Local optimistic turns keep the stream alive between send and reply.
  const [optimistic, setOptimistic] = useState<ChatTurnView[]>([]);
  const allTurns = useMemo(
    () => [...turns, ...optimistic],
    [turns, optimistic],
  );
  const pendingCalls = pendingToolCallIdsOf(allTurns);

  useEffect(() => {
    if (!hasOpenWindow(allTurns, nowTick)) {
      return;
    }
    const timer = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [allTurns, nowTick]);

  // Keep the newest item in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [allTurns.length, optimistic]);

  const revertMutation = useMutation({
    mutationFn: async (variables: { proposalId: string; turnId?: string }) => {
      const result = await ledgerClient.revertProposal(variables.proposalId);
      if (variables.turnId !== undefined) {
        // Display metadata only; a failure here never blocks the revert.
        await chatClient
          .reportOutcome(variables.turnId, "reverted")
          .catch(() => undefined);
      }
      return result;
    },
    onSuccess: (result) => {
      // The cached page is a ChatTurnPage, not a bare array.
      queryClient.setQueryData(messagesKey, (page) => {
        if (page === undefined || page === null) {
          return page;
        }
        const current = page as { turns: ChatTurnView[] };
        return {
          ...current,
          turns: current.turns.map((turn) => ({
            ...turn,
            card_outcome: turn.items.some(
              (item) =>
                "type" in item &&
                item.type === "proposal_card" &&
                item.proposal_id === result.proposal_id,
            )
              ? "reverted"
              : turn.card_outcome,
            items: turn.items.map((item) =>
              "type" in item &&
              item.type === "proposal_card" &&
              item.proposal_id === result.proposal_id
                ? {
                    ...item,
                    receipt:
                      ledgerReceiptOf(item) === undefined
                        ? item.receipt
                        : {
                            ...(item.receipt as LedgerReceiptView),
                            status: "reverted" as const,
                            reverted_at: result.reverted_at,
                          },
                  }
                : item,
            ),
          })),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => chatClient.sendMessage(text),
    onMutate: (text) => {
      setErrorText(null);
      setOptimistic((current) => [
        ...current,
        optimisticUserTurn(text, nextId.current++),
      ]);
      setDraft("");
    },
    onSuccess: (turn) => {
      setOptimistic((current) => current.slice(0, -1));
      // The reply may have created the session; invalidating both the
      // session list and the message window always lands the fresh turn.
      void turn;
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
    onError: (error) => {
      setOptimistic((current) => current.slice(0, -1));
      setErrorText(describeError(error));
    },
  });
  const sendPending = sendMutation.isPending;

  // Composer textarea auto-grows to MAX_INPUT_HEIGHT.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  function send(text: string): void {
    sendMutation.mutate(text);
  }

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

  const dismissed = useRef(new Set<string>());

  return (
    // Yuanbao-style flow: items sit directly on the page background (user
    // turns as bubbles, everything else as document content); only the
    // composer is a card.
    <section aria-label="对话" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-4"
        aria-live="polite"
      >
        {allTurns.length === 0 && !sendPending ? (
          <div className="flex flex-1 items-center justify-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {EMPTY_HEADLINE}
            </h2>
          </div>
        ) : (
          <>
            {allTurns.flatMap((turn) =>
              turn.items
                .filter(
                  (item) =>
                    !(
                      "type" in item &&
                      item.type === "proposal_card" &&
                      dismissed.current.has(item.proposal_id)
                    ),
                )
                .map((item: ChatItem, index: number) => (
                  <ItemView
                    key={`${turn.turn_id}-${index}`}
                    item={item}
                    nowMs={nowTick}
                    pendingToolCallIds={pendingCalls}
                    revertPending={revertMutation.isPending}
                    revertError={revertMutation.error}
                    onRevert={(proposalId) =>
                      revertMutation.mutate({
                        proposalId,
                        turnId: turn.turn_id,
                      })
                    }
                    onDismissCard={() => {
                      if ("type" in item && item.type === "proposal_card") {
                        dismissed.current.add(item.proposal_id);
                        setNowTick(Date.now());
                      }
                    }}
                  />
                )),
            )}
            {sendPending && (
              <p className="px-1 text-xs text-muted-foreground">正在思考…</p>
            )}
          </>
        )}
      </div>
      <form onSubmit={handleSubmit} aria-busy={sendPending} className="pt-2">
        {errorText && (
          <p className="px-1 pb-2 text-sm text-destructive">{errorText}</p>
        )}
        <div className="flex items-end gap-2 rounded-2xl bg-card py-2.5 pr-2.5 pl-4 shadow-[0_2px_6px_rgba(15,17,21,0.05),0_8px_24px_rgba(15,17,21,0.07)] transition-shadow focus-within:shadow-[0_0_0_3px_var(--accent-soft),0_8px_24px_rgba(15,17,21,0.07)]">
          <textarea
            ref={textareaRef}
            value={draft}
            rows={3}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="对话输入"
            placeholder="说点什么，例如：记一笔，昨天午饭花了 25"
            className="max-h-[200px] min-h-[72px] flex-1 resize-none border-none bg-transparent py-1.5 text-sm leading-relaxed outline-none"
          />
          <button
            type="submit"
            disabled={sendPending || draft.trim().length === 0}
            aria-label="发送"
            title="发送（Enter）"
            className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground transition-all duration-150 hover:opacity-90 active:scale-[0.92] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowUp className="size-[16px]" />
          </button>
        </div>
      </form>
    </section>
  );
}

/** A local user-only turn shown while the reply is being produced. */
function optimisticUserTurn(text: string, id: number): ChatTurnView {
  return {
    turn_id: `optimistic-${id}`,
    session_id: "optimistic",
    intent: "none",
    created_at: new Date().toISOString(),
    items: [
      {
        role: "user",
        content: text,
        timestamp: Date.now(),
      },
    ],
  };
}
