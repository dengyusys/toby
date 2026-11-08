/**
 * Chat domain types: the pure vocabulary of the unified conversation —
 * the closed item union, the turn/session views, and the seams this
 * domain uses instead of importing other business domains. Routable
 * domains register through `ChatDomainCapability` objects collected by
 * the composition root (src/chat-capability.ts); the intent set is
 * registry-derived, never a union here. Wire shapes are mirrored by hand
 * in packages/contract/src/chat-client.ts and pi-messages.ts — change
 * both sides together. Message items are pi-ai messages carried verbatim:
 * this file treats them opaquely (a role plus passthrough fields) because
 * the server never interprets transcript content — rendering is the
 * webs' job, and zero-translation replay is the contract. The same
 * opacity applies to card receipts: chat copies them through.
 */

/**
 * The routing intent: a registered capability's id, or "none" (chat's
 * own small-talk fallback). A string on the wire; the valid set is
 * server-internal, derived from the registered capabilities.
 */
export type ChatIntent = string;

/** A transcript message item — a pi-ai message, verbatim and opaque here. */
export type ChatMessageItem = { readonly role: string } & Readonly<
  Record<string, unknown>
>;

/** A write card: the receipt snapshot at creation time (born confirmed). */
export interface ProposalCardItem {
  readonly type: "proposal_card";
  readonly proposal_id: string;
  /** The capability id whose write produced this card. */
  readonly domain: string;
  /** Opaque passthrough — the webs render it per domain id. */
  readonly receipt: unknown;
}

/** A deterministic "view it" chip; the AI never annotates these. */
export interface InspectLinkItem {
  readonly type: "inspect_link";
  readonly source_tool_call_id: string;
  /** Preview-panel target, e.g. "ledger:2026-11". */
  readonly target: string;
  /** Chip label, e.g. "2026 年 11 月账单". */
  readonly label: string;
}

/** A plain notice bubble (fallback copy, on-the-way notes, truncation). */
export interface NoticeItem {
  readonly type: "notice";
  readonly text: string;
}

/** The closed item union; adding a type is an explicit decision. */
export type ChatItem =
  ChatMessageItem | ProposalCardItem | InspectLinkItem | NoticeItem;

/** One exchange: intent as metadata beside the ordered items. */
export interface ChatTurnView {
  readonly turn_id: string;
  readonly session_id: string;
  readonly intent: ChatIntent;
  readonly created_at: string;
  /** The card's recorded final state, display metadata only. */
  readonly card_outcome?: string;
  readonly items: readonly ChatItem[];
}

export interface ChatSessionView {
  readonly session_id: string;
  readonly created_at: string;
  /** Derived preview text, recomputed on read — never a stored item. */
  readonly excerpt: string;
}

export interface ChatTurnPage {
  /** Turns oldest → newest inside the fetched window. */
  readonly turns: readonly ChatTurnView[];
  /** Cursor for paging further back in time; absent at the beginning. */
  readonly next_before?: string;
}

/** Intent classification output: an intent plus a self-contained sentence. */
export interface IntentClassification {
  readonly intent: ChatIntent;
  readonly sentence: string;
}

/** Classifies one sentence; folding follow-up fragments is its job. */
export interface IntentClassifier {
  classify(
    text: string,
    history: readonly { readonly user: string; readonly reply: string }[],
  ): Promise<IntentClassification>;
}

/** One prior exchange replayed to the agent: text only, no tools or cards. */
export interface ChatHistoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly timestamp: number;
}

/** The `none`-intent agent's settled run, transcript included. */
export interface ChatAgentRun {
  /** Final assistant text ("" when none). */
  readonly text: string;
  /** The run's pi-ai transcript verbatim (system message included). */
  readonly messages: readonly unknown[];
  /**
   * Only this run's own messages (the new user prompt plus assistant turns
   * and tool results); the replayed history never re-lands here. Turn
   * items are built from this, not from `messages`.
   */
  readonly producedMessages: readonly unknown[];
}

/** The `none`-intent agent: read-only tools, bounded rounds, real data. */
export interface ChatAgent {
  run(
    prompt: string,
    history: readonly ChatHistoryMessage[],
  ): Promise<ChatAgentRun>;
}
