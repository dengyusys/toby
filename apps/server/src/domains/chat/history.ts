/**
 * Conversation memory: shaping stored turns into what the two AI
 * consumers read — pure projection, no store access (the service fetches
 * turn pages and hands them over). The classifier gets a compact view
 * (the last few exchanges as {user, reply} pairs); the none-agent gets a
 * text-only replay of every exchange inside the conversation window (user
 * words plus assistant text, verbatim), bounded only by the size cap
 * below. Both views share the HistoryTurn extraction below — the one seam
 * the two consumers have in common.
 */

import type { ChatHistoryMessage, ChatTurnView } from "./types.ts";

/** Prior turns the classifier folds a fragment against. */
const CLASSIFIER_TURNS = 3;
/**
 * Turns one send fetches for the classifier: its window plus the turn
 * just persisted and one interrupted turn (both reply-less, filtered out
 * below), so neither shrinks the window.
 */
export const CLASSIFIER_FETCH_LIMIT = CLASSIFIER_TURNS + 2;
/**
 * The most turns one send reads for the agent's window — the bound on
 * database work; past it the oldest drop.
 */
export const AGENT_HISTORY_FETCH_LIMIT = 200;
/**
 * The agent's replay size cap, in characters: a time window does not
 * bound the size, and a replay too large for the model fails the request
 * outright. The newest exchanges ride first, so the cap drops the oldest.
 */
const AGENT_HISTORY_MAX_CHARS = 30_000;

/** One settled exchange, in both the classifier's and the agent's view. */
export interface HistoryTurn {
  readonly user: string;
  /** What the classifier sees as the reply: assistant text or a notice. */
  readonly reply: string;
  /** What the agent replays: assistant text only, joined across the turn. */
  readonly assistant_text: string;
  readonly created_at: string;
}

/** Settled turns only (a reply exists), in page order. */
export function historyTurnsOf(turns: readonly ChatTurnView[]): HistoryTurn[] {
  return turns
    .filter((turn) => turn.items.length > 1)
    .map((turn) => ({
      user: excerptOfTurn(turn),
      reply: replyTextOfTurn(turn),
      assistant_text: assistantTextOfTurn(turn),
      created_at: turn.created_at,
    }));
}

/** The classifier's compact history: the last few exchanges, verbatim. */
export function classifierHistoryOf(turns: readonly HistoryTurn[]): {
  user: string;
  reply: string;
}[] {
  return turns
    .slice(-CLASSIFIER_TURNS)
    .map((turn) => ({ user: turn.user, reply: turn.reply }));
}

/**
 * The agent's replay: text only, oldest first, every settled exchange
 * inside the window `windowMs` back from `now` — and never past the size
 * cap, the oldest dropping first. The newest exchange always rides whole,
 * so an oversized one cannot empty the replay. `now` and the window are
 * passed in, not clocked here: pure projection stays testable.
 */
export function agentHistoryOf(
  turns: readonly HistoryTurn[],
  now: number,
  windowMs: number,
): ChatHistoryMessage[] {
  const fresh: { turn: HistoryTurn; timestamp: number }[] = [];
  for (const turn of turns) {
    const parsed = Date.parse(turn.created_at);
    const timestamp = Number.isNaN(parsed) ? now : parsed;
    if (now - timestamp <= windowMs) {
      fresh.push({ turn, timestamp });
    }
  }
  const kept: { turn: HistoryTurn; timestamp: number }[] = [];
  let size = 0;
  for (let index = fresh.length - 1; index >= 0; index -= 1) {
    const entry = fresh[index]!;
    const exchangeSize =
      entry.turn.user.length + entry.turn.assistant_text.length;
    if (kept.length > 0 && size + exchangeSize > AGENT_HISTORY_MAX_CHARS) {
      break;
    }
    kept.push(entry);
    size += exchangeSize;
  }
  const messages: ChatHistoryMessage[] = [];
  for (const { turn, timestamp } of kept.reverse()) {
    if (turn.user.length > 0) {
      messages.push({ role: "user", text: turn.user, timestamp });
    }
    if (turn.assistant_text.length > 0) {
      messages.push({
        role: "assistant",
        text: turn.assistant_text,
        timestamp,
      });
    }
  }
  return messages;
}

/** The assistant text items of one turn joined, in order; no notices/cards. */
function assistantTextOfTurn(turn: ChatTurnView): string {
  const parts: string[] = [];
  for (const item of turn.items) {
    if ((item as { role?: unknown }).role !== "assistant") {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const record = block as { type?: string; text?: string };
      if (record.type === "text" && typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("\n").trim();
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
