/**
 * Conversation memory: shaping stored turns into what the two AI
 * consumers read — pure projection, no store access (the service fetches
 * a turn page and hands it over). The classifier gets a compact view
 * (last few exchanges as {user, reply} pairs); the none-agent gets a
 * text-only replay (user words plus assistant text, capped, and only
 * turns fresh enough to matter). Both views share the HistoryTurn
 * extraction below — the one seam the two consumers have in common.
 */

import type { ChatHistoryMessage, ChatTurnView } from "./types.ts";

/** Prior turns the classifier folds a fragment against. */
const CLASSIFIER_TURNS = 3;
/** Prior turns replayed to the agent; more loses the thread, less forgets it. */
const AGENT_HISTORY_TURNS = 4;
/**
 * A turn older than this is stale for the agent: after a long gap the user
 * is starting a new thread, and replaying yesterday's reply only confuses it.
 */
const AGENT_HISTORY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** One text's cap in replayed history — a long report must not eat the budget. */
const HISTORY_TEXT_MAX_CHARS = 500;

/**
 * How many turns to fetch for one send: the replay window plus one — the
 * just-persisted turn sits in the page without a reply yet and is filtered
 * out below, so it never folds onto itself.
 */
export const HISTORY_FETCH_LIMIT = AGENT_HISTORY_TURNS + 1;

/** One settled exchange, in both the classifier's and the agent's view. */
export interface HistoryTurn {
  readonly user: string;
  /** What the classifier sees as the reply: assistant text or a notice. */
  readonly reply: string;
  /** What the agent replays: assistant text only, joined across the turn. */
  readonly assistant_text: string;
  readonly created_at: string;
}

/** Settled turns only (a reply exists), newest window last. */
export function historyTurnsOf(turns: readonly ChatTurnView[]): HistoryTurn[] {
  return turns
    .filter((turn) => turn.items.length > 1)
    .slice(-AGENT_HISTORY_TURNS)
    .map((turn) => ({
      user: excerptOfTurn(turn),
      reply: replyTextOfTurn(turn),
      assistant_text: assistantTextOfTurn(turn),
      created_at: turn.created_at,
    }));
}

/** The classifier's compact history: the last few exchanges. */
export function classifierHistoryOf(turns: readonly HistoryTurn[]): {
  user: string;
  reply: string;
}[] {
  return turns.slice(-CLASSIFIER_TURNS).map((turn) => ({
    user: clipHistoryText(turn.user),
    reply: clipHistoryText(turn.reply),
  }));
}

/**
 * The agent's replay: text only, oldest first, each text capped, and only
 * turns from the last six hours — a longer gap starts a new thread.
 * `now` is passed in, not clocked here: pure projection stays testable.
 */
export function agentHistoryOf(
  turns: readonly HistoryTurn[],
  now: number,
): ChatHistoryMessage[] {
  const messages: ChatHistoryMessage[] = [];
  for (const turn of turns) {
    const parsed = Date.parse(turn.created_at);
    const timestamp = Number.isNaN(parsed) ? now : parsed;
    if (now - timestamp > AGENT_HISTORY_MAX_AGE_MS) {
      continue;
    }
    const user = clipHistoryText(turn.user);
    if (user.length > 0) {
      messages.push({ role: "user", text: user, timestamp });
    }
    const reply = clipHistoryText(turn.assistant_text);
    if (reply.length > 0) {
      messages.push({ role: "assistant", text: reply, timestamp });
    }
  }
  return messages;
}

/** A replayed text's cap: history is context, not a transcript copy. */
function clipHistoryText(text: string): string {
  return text.length <= HISTORY_TEXT_MAX_CHARS
    ? text
    : `${text.slice(0, HISTORY_TEXT_MAX_CHARS)}…`;
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
