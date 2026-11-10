/**
 * Chat domain wire contract: the closed item union (pi-ai transcript
 * messages plus toby items), the turn/session views, and the typed
 * client. Every reply is an ordered stream of items rendered in order;
 * pairing rides on `toolCallId`, provenance on `source_tool_call_id`
 * (docs/features/chat.md).
 */

import type { PiTranscriptMessage } from "./pi-messages.ts";
import { endpoint, requestJson } from "./request-json.ts";

/**
 * The routing intent: a registered capability's id, or "none". A string
 * on the wire — the valid set is server-internal, derived from the
 * registered domain capabilities (docs/decisions/chat-domain-capabilities.md);
 * this file stops changing when domains land.
 */
export type ChatIntent = string;

/** A transcript message, exactly as pi-ai produced it. */
export type ChatMessageItem = PiTranscriptMessage;

/** A write card: the receipt snapshot at creation time (born confirmed). */
export interface ProposalCardItem {
  readonly type: "proposal_card";
  readonly proposal_id: string;
  /** The capability id whose write produced this card. */
  readonly domain: string;
  /**
   * Opaque passthrough: each web narrows it with the domain's own client
   * types inside its card renderer, keyed by `domain`.
   */
  readonly receipt: unknown;
}

/**
 * A deterministic "view it" chip: read-only tools actually called map to
 * these; the AI never annotates them. Jumps to the matching preview panel.
 */
export interface InspectLinkItem {
  readonly type: "inspect_link";
  /** The tool call whose data the panel will show. */
  readonly source_tool_call_id: string;
  /** Preview-panel target, e.g. "ledger:2026-11". */
  readonly target: string;
  /** Chip label, e.g. "本月账单". */
  readonly label: string;
}

/** A plain notice bubble (fallback copy, on-the-way notes, truncation). */
export interface NoticeItem {
  readonly type: "notice";
  readonly text: string;
}

/**
 * The closed item union. Adding a type is an explicit decision recorded in
 * docs/features/chat.md — never a silent extension.
 */
export type ChatItem =
  ChatMessageItem | ProposalCardItem | InspectLinkItem | NoticeItem;

/** One exchange: the routing intent as metadata beside the ordered items. */
export interface ChatTurnView {
  readonly turn_id: string;
  readonly session_id: string;
  readonly intent: ChatIntent;
  readonly created_at: string;
  readonly items: readonly ChatItem[];
}

export interface ChatSessionView {
  readonly session_id: string;
  readonly created_at: string;
  /** Derived preview text, recomputed on read — never a stored item. */
  readonly excerpt: string;
}

export interface ChatTurnPage {
  /** The session's newest turns, oldest → newest. */
  readonly turns: readonly ChatTurnView[];
}

export interface ChatClient {
  /** One sentence in: intent routing; returns the turn's intent and items. */
  sendMessage(text: string): Promise<ChatTurnView>;
  listSessions(): Promise<readonly ChatSessionView[]>;
  listMessages(
    sessionId: string,
    options?: { limit?: number },
  ): Promise<ChatTurnPage>;
}

export function createChatClient(baseUrl: string): ChatClient {
  return {
    sendMessage: (text) =>
      requestJson<ChatTurnView>(endpoint(baseUrl, "/api/chat/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }),
    listSessions: async () => {
      const body = await requestJson<{ sessions: ChatSessionView[] }>(
        endpoint(baseUrl, "/api/chat/sessions"),
      );
      return body.sessions;
    },
    listMessages: (sessionId, options) => {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) {
        params.set("limit", String(options.limit));
      }
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return requestJson<ChatTurnPage>(
        endpoint(
          baseUrl,
          `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${query}`,
        ),
      );
    },
  };
}
