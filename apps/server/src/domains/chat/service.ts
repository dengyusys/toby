/**
 * Chat service: the use-case layer of the unified conversation — pure
 * orchestration plus the session/turn queries. One send is: validate →
 * rate-limit → persist the user turn (before any AI call) → classify →
 * route — a registered capability's write lands immediately through its
 * handleWrite (a receipt card is born), "none" and any intent the
 * registry no longer knows go to the read-only agent. Reply items are
 * synthesized in items.ts; the AI's view of past turns is shaped in
 * history.ts. Every AI failure settles as an honest notice — never a
 * 5xx, never silently dropped (docs/features/chat.md).
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { ChatDomainCapability } from "../../chat-capability.ts";
import { AiError } from "../../infrastructure/model/errors.ts";
import { ChatRequestError } from "./errors.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { ChatRepository, StoredTurn } from "./repository.ts";
import type {
  ChatAgent,
  ChatHistoryMessage,
  ChatIntent,
  ChatItem,
  ChatSessionView,
  ChatTurnPage,
  ChatTurnView,
  IntentClassifier,
} from "./types.ts";
import {
  agentHistoryOf,
  classifierHistoryOf,
  HISTORY_FETCH_LIMIT,
  historyTurnsOf,
} from "./history.ts";
import {
  assistantTextItem,
  cardItemOf,
  inspectLinksOf,
  noticeItem,
  transcriptItemsOf,
  userMessageItem,
} from "./items.ts";

const SAY_THAT_AGAIN = "没听清,再说一遍?";
const AGENT_FALLBACK = "查询出了点问题,稍后再试一次。";

const UNCONFIGURED_MESSAGE =
  'AI is not configured: set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

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
  repository: ChatRepository;
  clock: Clock;
  classifier?: IntentClassifier;
  agent?: ChatAgent;
  /** The registered capabilities, keyed by intent id. */
  capabilities: ReadonlyMap<string, ChatDomainCapability>;
  limiter: RateLimiter;
}): ChatService {
  const { repository, clock, capabilities } = deps;

  async function route(
    intent: ChatIntent,
    sentence: string,
    history: readonly ChatHistoryMessage[],
  ): Promise<{ intent: ChatIntent; items: ChatItem[] }> {
    const capability = capabilities.get(intent);
    if (capability !== undefined) {
      const outcome = await capability.handleWrite(sentence);
      if (outcome.kind === "question") {
        return {
          intent,
          items: [assistantTextItem(outcome.text, clock())],
        };
      }
      if (outcome.kind === "notice") {
        return { intent, items: [noticeItem(outcome.text)] };
      }
      return {
        intent,
        items: [
          assistantTextItem(outcome.confirmText, clock()),
          cardItemOf(capability.intent, outcome),
        ],
      };
    }
    // "none", or an intent the registry no longer knows: degrade to the
    // none-agent — never a 404, never a silent drop.
    if (!deps.agent) {
      return { intent: "none", items: [noticeItem(AGENT_FALLBACK)] };
    }
    try {
      const run = await deps.agent.run(sentence, history);
      // Items come from the run's own transcript only — run.messages also
      // carries the replayed history, which must never be re-stored as this
      // turn's output (each polluted turn would then pollute the next).
      const items = [
        ...transcriptItemsOf(run.producedMessages),
        ...inspectLinksOf(run.producedMessages, capabilities),
      ];
      // A run that produced nothing visible still answers honestly.
      return {
        intent: "none",
        items: items.length > 0 ? items : [noticeItem(AGENT_FALLBACK)],
      };
    } catch (error) {
      if (error instanceof AiError && error.code === "unconfigured") {
        return { intent: "none", items: [noticeItem(UNCONFIGURED_MESSAGE)] };
      }
      return { intent: "none", items: [noticeItem(AGENT_FALLBACK)] };
    }
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
      const session = await repository.ensureSession();
      // The user's words persist before any AI is called; the turn's
      // intent is provisional until routing settles.
      const userItem = userMessageItem(trimmed, clock());
      const turn = await repository.appendUserTurn(session.id, userItem);

      let routed: { intent: ChatIntent; items: ChatItem[] };
      if (!deps.classifier) {
        routed = { intent: "none", items: [noticeItem(UNCONFIGURED_MESSAGE)] };
      } else {
        try {
          // History holds only settled turns (the just-persisted one has
          // no reply items yet, so it never folds onto itself).
          const page = await repository.listTurns(session.id, {
            limit: HISTORY_FETCH_LIMIT,
          });
          const turns = historyTurnsOf(page.turns);
          const classification = await deps.classifier.classify(
            trimmed,
            classifierHistoryOf(turns),
          );
          routed = await route(
            classification.intent,
            classification.sentence,
            agentHistoryOf(turns, clock()),
          );
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

      await repository.setTurnIntent(turn.id, routed.intent);
      await repository.completeTurn(turn.id, routed.items);
      return {
        turn_id: turn.id,
        session_id: session.id,
        intent: routed.intent,
        created_at: turn.created_at,
        items: [userItem, ...routed.items],
      };
    },

    async listSessions() {
      return { sessions: await repository.listSessions() };
    },

    async createSession() {
      const session = await repository.createSession();
      return {
        session_id: session.id,
        created_at: session.created_at,
        excerpt: "(新对话)",
      };
    },

    async listMessages(sessionId, options) {
      const limit = parseLimit(options.limit);
      const page = await repository.listTurns(sessionId, {
        limit,
        ...(options.before !== undefined ? { before: options.before } : {}),
      });
      if (page.turns.length === 0) {
        // An empty page is honest for a live session that has no turns yet
        // (created through the API) or for a cursor at the oldest turn;
        // only a session that does not exist answers 404.
        const sessions = await repository.listSessions();
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
      const deleted = await repository.deleteSession(id);
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
      const turn: StoredTurn | undefined = await repository.getTurn(turnId);
      if (!turn) {
        throw new ChatRequestError(
          "TURN_NOT_FOUND",
          404,
          "turn does not exist",
        );
      }
      await repository.setCardOutcome(turnId, outcome);
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
