/**
 * Chat repository: hand-written SQL over the chat database (db.ts owns
 * the connection and schema). Sessions → turns → items: one turn is one
 * exchange (a user message item, then the reply items in order); the
 * user message persists in its own transaction before any AI call, so an
 * interrupted turn honestly shows the user's words and nothing else.
 * Item payloads are the wire items verbatim (JSON); excerpt is derived
 * on read, never stored.
 */

import { randomUUID } from "node:crypto";
import type { Clock } from "../../infrastructure/clock.ts";
import type { DomainDb } from "../../infrastructure/db/types.ts";
import type { ChatDb } from "./db.ts";
import type {
  ChatIntent,
  ChatItem,
  ChatSessionView,
  ChatTurnPage,
  ChatTurnView,
} from "./types.ts";

export interface ChatRepository {
  /** The single ongoing conversation, created on first call. */
  ensureSession(): Promise<{ id: string; created_at: string }>;
  /** Persists the turn with its user message item — before any AI call. */
  appendUserTurn(
    sessionId: string,
    userItem: ChatItem,
  ): Promise<{ id: string; created_at: string }>;
  /** Replaces the provisional intent once routing settles. */
  setTurnIntent(turnId: string, intent: ChatIntent): Promise<void>;
  /** Appends the reply items in order, one transaction. */
  completeTurn(turnId: string, items: readonly ChatItem[]): Promise<void>;
  /** The newest `limit` turns of one session, oldest → newest. */
  listTurns(
    sessionId: string,
    options: { limit: number },
  ): Promise<ChatTurnPage>;
  /** Sessions newest first, excerpt derived from each one's latest turn. */
  listSessions(): Promise<readonly ChatSessionView[]>;
}

interface TurnRow {
  readonly seq: number;
  readonly id: string;
  readonly session_id: string;
  readonly intent: string;
  readonly created_at: string;
}

function isIntent(value: string): value is ChatIntent {
  return ["ledger", "schedule", "memory", "notes", "todo", "none"].includes(
    value,
  );
}

/** The excerpt of one session: its newest turn's user words. */
function excerptOf(items: readonly ChatItem[]): string {
  const userItem = items.find(
    (item) => (item as { role?: unknown }).role === "user",
  );
  const content = (userItem as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") {
    return content.length > 60 ? `${content.slice(0, 60)}…` : content;
  }
  return "(新对话)";
}

export function createChatRepository(deps: {
  db: ChatDb;
  clock: Clock;
}): ChatRepository {
  const { db, clock } = deps;

  async function itemsOfTurns(
    handle: DomainDb,
    turnIds: readonly string[],
  ): Promise<Map<string, ChatItem[]>> {
    const byTurn = new Map<string, ChatItem[]>();
    if (turnIds.length === 0) {
      return byTurn;
    }
    const placeholders = turnIds.map(() => "?").join(", ");
    const rows = await handle.query<{ turn_id: string; payload: string }>(
      `SELECT turn_id, payload FROM chat_items WHERE turn_id IN (${placeholders}) ORDER BY turn_id, seq`,
      turnIds,
    );
    for (const row of rows) {
      const list = byTurn.get(row.turn_id) ?? [];
      list.push(JSON.parse(row.payload) as ChatItem);
      byTurn.set(row.turn_id, list);
    }
    return byTurn;
  }

  function toView(row: TurnRow, items: readonly ChatItem[]): ChatTurnView {
    return {
      turn_id: row.id,
      session_id: row.session_id,
      intent: isIntent(row.intent) ? row.intent : "none",
      created_at: row.created_at,
      items,
    };
  }

  return {
    async ensureSession() {
      const handle = await db.open();
      const existing = await handle.query<{ id: string; created_at: string }>(
        "SELECT id, created_at FROM chat_sessions ORDER BY created_at DESC, id DESC LIMIT 1",
      );
      if (existing.length > 0) {
        return existing[0]!;
      }
      return createSessionRow(handle, clock);
    },

    async appendUserTurn(sessionId, userItem) {
      const handle = await db.open();
      const id = randomUUID();
      const createdAt = new Date(clock()).toISOString();
      await handle.transaction(async (tx) => {
        await tx.run(
          "INSERT INTO chat_turns (id, session_id, intent, created_at) VALUES (?, ?, ?, ?)",
          [id, sessionId, "none", createdAt],
        );
        await tx.run(
          "INSERT INTO chat_items (turn_id, seq, payload, created_at) VALUES (?, ?, ?, ?)",
          [id, 0, JSON.stringify(userItem), createdAt],
        );
      });
      return { id, created_at: createdAt };
    },

    async setTurnIntent(turnId, intent) {
      const handle = await db.open();
      await handle.run("UPDATE chat_turns SET intent = ? WHERE id = ?", [
        intent,
        turnId,
      ]);
    },

    async completeTurn(turnId, items) {
      const handle = await db.open();
      const createdAt = new Date(clock()).toISOString();
      await handle.transaction(async (tx) => {
        let seq = 1;
        for (const item of items) {
          await tx.run(
            "INSERT INTO chat_items (turn_id, seq, payload, created_at) VALUES (?, ?, ?, ?)",
            [turnId, seq, JSON.stringify(item), createdAt],
          );
          seq += 1;
        }
      });
    },

    async listTurns(sessionId, options) {
      const handle = await db.open();
      const descending = await handle.query<TurnRow>(
        `SELECT seq, id, session_id, intent, created_at FROM chat_turns
         WHERE session_id = ? ORDER BY seq DESC LIMIT ?`,
        [sessionId, options.limit],
      );
      const ascending = [...descending].reverse();
      const byTurn = await itemsOfTurns(
        handle,
        ascending.map((row) => row.id),
      );
      return {
        turns: ascending.map((row) => toView(row, byTurn.get(row.id) ?? [])),
      };
    },

    async listSessions() {
      const handle = await db.open();
      const sessions = await handle.query<{
        id: string;
        created_at: string;
      }>(
        "SELECT id, created_at FROM chat_sessions ORDER BY created_at DESC, id DESC",
      );
      const views: ChatSessionView[] = [];
      for (const session of sessions) {
        const latestTurn = await handle.query<{ id: string }>(
          "SELECT id FROM chat_turns WHERE session_id = ? ORDER BY seq DESC LIMIT 1",
          [session.id],
        );
        let excerpt = "(新对话)";
        const turnId = latestTurn[0]?.id;
        if (turnId !== undefined) {
          const items = (await itemsOfTurns(handle, [turnId])).get(turnId);
          if (items !== undefined) {
            excerpt = excerptOf(items);
          }
        }
        views.push({
          session_id: session.id,
          created_at: session.created_at,
          excerpt,
        });
      }
      return views;
    },
  };
}

async function createSessionRow(
  handle: DomainDb,
  clock: Clock,
): Promise<{ id: string; created_at: string }> {
  const id = randomUUID();
  const createdAt = new Date(clock()).toISOString();
  await handle.run("INSERT INTO chat_sessions (id, created_at) VALUES (?, ?)", [
    id,
    createdAt,
  ]);
  return { id, created_at: createdAt };
}
