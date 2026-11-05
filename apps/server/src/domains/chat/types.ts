/**
 * Chat domain types: the pure vocabulary of the unified conversation —
 * the closed item union, the turn/session views, and the injected ports
 * this domain calls instead of importing other business domains (the
 * composition root adapts real domains to these shapes; structural typing
 * does the glue). Wire shapes are mirrored by hand in
 * packages/contract/src/chat-client.ts and pi-messages.ts — change both
 * sides together. Message items are pi-ai messages carried verbatim: this
 * file treats them opaquely (a role plus passthrough fields) because the
 * server never interprets transcript content — rendering is the webs'
 * job, and zero-translation replay is the contract.
 */

/** The routing intents: the full set, fixed once at full breadth. */
export type ChatIntent =
  "ledger" | "schedule" | "memory" | "notes" | "todo" | "none";

/** A transcript message item — a pi-ai message, verbatim and opaque here. */
export type ChatMessageItem = { readonly role: string } & Readonly<
  Record<string, unknown>
>;

/** A write card: the receipt snapshot at creation time (born confirmed). */
export interface ProposalCardItem {
  readonly type: "proposal_card";
  readonly proposal_id: string;
  readonly domain: "ledger";
  readonly receipt: ChatLedgerReceipt;
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

/**
 * The ledger receipt snapshot a proposal card embeds — the ledger wire
 * shape, declared structurally (no cross-domain import; the composition
 * root passes the real ledger service, which satisfies this).
 */
export interface ChatLedgerReceipt {
  readonly proposal_id: string;
  readonly status: "committed" | "reverted";
  readonly created_at: string;
  readonly committed_at: string;
  readonly revert_until: string;
  readonly reverted_at?: string;
  readonly written: number;
  readonly transaction_ids: readonly number[];
  readonly entries: readonly {
    readonly date: string;
    readonly type: "income" | "expense";
    readonly category: string;
    readonly account: string;
    readonly amount: number;
    readonly note: string;
  }[];
}

/** The ledger asking the user one clarifying question (nothing written). */
export interface ChatLedgerFollowUp {
  readonly question: string;
}

/** The ledger month summary, trimmed to what the chat agent formats. */
export interface ChatLedgerMonthSummary {
  readonly month: string;
  readonly income_total: number;
  readonly expense_total: number;
  readonly categories: readonly {
    readonly type: string;
    readonly category: string;
    readonly total: number;
  }[];
  readonly transactions: readonly {
    readonly date: string;
    readonly type: string;
    readonly category: string;
    readonly account: string;
    readonly amount: number;
    readonly note: string;
  }[];
}

/**
 * The ledger as the chat domain sees it: recording runs immediately and
 * returns a born-confirmed receipt; reads serve the agent's tools.
 */
export interface ChatLedgerPort {
  recordFromText(text: string): Promise<ChatLedgerReceipt | ChatLedgerFollowUp>;
  months(): Promise<{ readonly months: readonly string[] }>;
  monthReport(month: string): Promise<ChatLedgerMonthSummary>;
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

/** The `none`-intent agent's settled run, transcript included. */
export interface ChatAgentRun {
  /** Final assistant text ("" when none). */
  readonly text: string;
  /** The run's pi-ai transcript verbatim (system message included). */
  readonly messages: readonly unknown[];
}

/** The `none`-intent agent: read-only tools, bounded rounds, real data. */
export interface ChatAgent {
  run(prompt: string): Promise<ChatAgentRun>;
}
