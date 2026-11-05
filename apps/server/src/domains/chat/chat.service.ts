/**
 * Chat service: the use-case layer of the unified conversation. One send
 * is: validate → rate-limit → persist the user turn (before any AI call)
 * → classify → route — ledger writes land immediately through the port
 * (a receipt card is born), landed-domain-but-not-built intents answer
 * an on-the-way notice, everything else goes to the read-only agent whose
 * verbatim transcript becomes message items plus deterministic inspect
 * links. Every AI failure settles as an honest notice — never a 5xx,
 * never silently dropped (docs/features/chat.md).
 */

import type { Clock } from "../../infrastructure/clock.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import { ChatRequestError } from "./errors.ts";
import { inspectTargetOf } from "./agent.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { ChatStore, StoredTurn } from "./store.ts";
import type {
  ChatAgent,
  ChatIntent,
  ChatItem,
  ChatLedgerPort,
  ChatSessionView,
  ChatTurnPage,
  ChatTurnView,
  IntentClassifier,
} from "./types.ts";

/** Copy for intents whose domains have not landed yet. */
const ON_THE_WAY: Record<Exclude<ChatIntent, "ledger" | "none">, string> = {
  schedule: "日程功能还在路上,落地后这里就能直接安排。",
  memory: "长期记忆功能还在路上,落地后我就能记住你的偏好。",
  notes: "手账功能还在路上,落地后随口一句话就能记下来。",
  todo: "告示板功能还在路上,落地后一句话就能把事挂上去。",
};

const SAY_THAT_AGAIN = "没听清,再说一遍?";
const AGENT_FALLBACK = "查询出了点问题,稍后再试一次。";

const UNCONFIGURED_MESSAGE =
  'AI is not configured: set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const HISTORY_TURNS = 3;

/** The minimal well-formed pi-ai shapes the service synthesizes itself. */
function userMessageItem(text: string, timestamp: number): ChatItem {
  return { role: "user", content: text, timestamp };
}

function assistantTextItem(text: string, timestamp: number): ChatItem {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 0,
      output: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function noticeItem(text: string): ChatItem {
  return { type: "notice", text };
}

/** Transcript items from an agent run: assistant/toolResult verbatim, system dropped. */
function transcriptItemsOf(messages: readonly unknown[]): ChatItem[] {
  return messages.flatMap((message) => {
    const role = (message as { role?: unknown }).role;
    // The run's own user messages duplicate what this turn already shows.
    return role === "assistant" || role === "toolResult"
      ? [message as ChatItem]
      : [];
  });
}

/** Deterministic inspect links for the read-only tools actually called. */
function inspectLinksOf(messages: readonly unknown[]): ChatItem[] {
  const links: ChatItem[] = [];
  for (const message of messages) {
    if ((message as { role?: unknown }).role !== "assistant") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const record = block as Record<string, unknown>;
      if (record.type !== "toolCall" || typeof record.id !== "string") {
        continue;
      }
      const target = inspectTargetOf(
        typeof record.name === "string" ? record.name : "",
        (record.arguments ?? {}) as Record<string, unknown>,
      );
      if (target !== undefined) {
        links.push({
          type: "inspect_link",
          source_tool_call_id: record.id,
          ...target,
        });
      }
    }
  }
  return links;
}

export interface ChatService {
  sendMessage(text: string, clientIp: string): Promise<ChatTurnView>;
  listSessions(): Promise<{ sessions: readonly ChatSessionView[] }>;
  createSession(): Promise<ChatSessionView>;
  listMessages(
    sessionId: string,
    options: { limit?: string; before?: string },
  ): Promise<ChatTurnPage>;
  deleteSession(id: string): Promise<{ status: "deleted" }>;
  reportOutcome(
    turnId: string,
    outcome: string,
  ): Promise<{ status: "recorded" }>;
}

export function createChatService(deps: {
  store: ChatStore;
  clock: Clock;
  classifier?: IntentClassifier;
  agent?: ChatAgent;
  ledger?: ChatLedgerPort;
  limiter: RateLimiter;
}): ChatService {
  const { store, clock } = deps;

  /** The recent exchange history the classifier folds against. */
  async function recentHistory(
    sessionId: string,
  ): Promise<{ user: string; reply: string }[]> {
    const page = await store.listTurns(sessionId, {
      limit: HISTORY_TURNS,
    });
    return page.turns
      .filter((turn) => turn.items.length > 1)
      .map((turn) => ({
        user: excerptOfTurn(turn),
        reply: replyTextOfTurn(turn),
      }));
  }

  async function route(
    intent: ChatIntent,
    sentence: string,
  ): Promise<{ intent: ChatIntent; items: ChatItem[] }> {
    if (intent === "ledger") {
      if (!deps.ledger) {
        return { intent, items: [noticeItem("记账功能未接入。")] };
      }
      const result = await deps.ledger.recordFromText(sentence);
      if ("question" in result) {
        return {
          intent,
          items: [assistantTextItem(result.question, clock())],
        };
      }
      return {
        intent,
        items: [
          assistantTextItem(
            `已记入 ${result.written} 笔,短时间内在卡片上可撤销。`,
            clock(),
          ),
          {
            type: "proposal_card",
            proposal_id: result.proposal_id,
            domain: "ledger",
            receipt: result,
          },
        ],
      };
    }
    if (intent === "none") {
      if (!deps.agent) {
        return { intent, items: [noticeItem(AGENT_FALLBACK)] };
      }
      try {
        const run = await deps.agent.run(sentence);
        const items = [
          ...transcriptItemsOf(run.messages),
          ...inspectLinksOf(run.messages),
        ];
        // A run that produced nothing visible still answers honestly.
        return {
          intent,
          items: items.length > 0 ? items : [noticeItem(AGENT_FALLBACK)],
        };
      } catch (error) {
        if (error instanceof AiError && error.code === "unconfigured") {
          return { intent, items: [noticeItem(UNCONFIGURED_MESSAGE)] };
        }
        return { intent, items: [noticeItem(AGENT_FALLBACK)] };
      }
    }
    return { intent, items: [noticeItem(ON_THE_WAY[intent])] };
  }

  return {
    async sendMessage(text, clientIp) {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        throw new ChatRequestError(
          "INVALID_TEXT",
          400,
          "text must not be empty",
        );
      }
      if (!deps.limiter.consume(clientIp)) {
        throw new ChatRequestError(
          "RATE_LIMITED",
          429,
          "too many messages, slow down",
        );
      }
      const session = await store.ensureSession();
      // The user's words persist before any AI is called; the turn's
      // intent is provisional until routing settles.
      const userItem = userMessageItem(trimmed, clock());
      const turn = await store.appendUserTurn(session.id, userItem);

      let routed: { intent: ChatIntent; items: ChatItem[] };
      if (!deps.classifier) {
        routed = { intent: "none", items: [noticeItem(UNCONFIGURED_MESSAGE)] };
      } else {
        try {
          // History holds only settled turns (the just-persisted one has
          // no reply items yet, so it never folds onto itself).
          const history = await recentHistory(session.id);
          const classification = await deps.classifier.classify(
            trimmed,
            history,
          );
          routed = await route(classification.intent, classification.sentence);
        } catch (error) {
          if (error instanceof AiError && error.code === "unconfigured") {
            routed = {
              intent: "none",
              items: [noticeItem(UNCONFIGURED_MESSAGE)],
            };
          } else if (error instanceof ChatRequestError) {
            throw error;
          } else {
            // Classification or routing failure: honest copy, never 5xx.
            routed = { intent: "none", items: [noticeItem(SAY_THAT_AGAIN)] };
          }
        }
      }

      await store.setTurnIntent(turn.id, routed.intent);
      await store.completeTurn(turn.id, routed.items);
      return {
        turn_id: turn.id,
        session_id: session.id,
        intent: routed.intent,
        created_at: turn.created_at,
        items: [userItem, ...routed.items],
      };
    },

    async listSessions() {
      return { sessions: await store.listSessions() };
    },

    async createSession() {
      const session = await store.createSession();
      return {
        session_id: session.id,
        created_at: session.created_at,
        excerpt: "(新对话)",
      };
    },

    async listMessages(sessionId, options) {
      const limit = parseLimit(options.limit);
      const page = await store.listTurns(sessionId, {
        limit,
        ...(options.before !== undefined ? { before: options.before } : {}),
      });
      if (page.turns.length === 0 && options.before === undefined) {
        // An empty first page is only honest for a session that does not
        // exist; existing-but-empty sessions are impossible (a turn
        // always carries the user message).
        const sessions = await store.listSessions();
        if (!sessions.some((s) => s.session_id === sessionId)) {
          throw new ChatRequestError(
            "SESSION_NOT_FOUND",
            404,
            "session does not exist",
          );
        }
      }
      return page;
    },

    async deleteSession(id) {
      const deleted = await store.deleteSession(id);
      if (!deleted) {
        throw new ChatRequestError(
          "SESSION_NOT_FOUND",
          404,
          "session does not exist",
        );
      }
      return { status: "deleted" as const };
    },

    async reportOutcome(turnId, outcome) {
      const turn: StoredTurn | undefined = await store.getTurn(turnId);
      if (!turn) {
        throw new ChatRequestError(
          "TURN_NOT_FOUND",
          404,
          "turn does not exist",
        );
      }
      await store.setCardOutcome(turnId, outcome);
      return { status: "recorded" as const };
    },
  };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PAGE_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    throw new ChatRequestError(
      "INVALID_TEXT",
      400,
      "limit must be an integer between 1 and 100",
    );
  }
  return parsed;
}

/** The user words of one stored turn ("" when nothing readable). */
function excerptOfTurn(turn: ChatTurnView): string {
  const userItem = turn.items.find(
    (item) => (item as { role?: unknown }).role === "user",
  );
  const content = (userItem as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : "";
}

/** The last visible text of one stored turn, for the classifier's history. */
function replyTextOfTurn(turn: ChatTurnView): string {
  for (const item of [...turn.items].reverse()) {
    if ((item as { role?: unknown }).role === "assistant") {
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        const text = content
          .map((block) =>
            (block as { type?: string; text?: string }).type === "text"
              ? (block as { text?: string }).text
              : "",
          )
          .join("");
        if (text.length > 0) {
          return text;
        }
      }
    }
    if ((item as { type?: unknown }).type === "notice") {
      return (item as { text?: string }).text ?? "";
    }
  }
  return "";
}
