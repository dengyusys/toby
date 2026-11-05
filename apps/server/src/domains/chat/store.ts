/**
 * Chat store: hand-written SQL over the chat database (data/chat.db on
 * SQLite, toby_chat on MySQL). Sessions → turns → items: one turn is one
 * exchange (a user message item, then the reply items in order); the
 * user message persists in its own transaction before any AI call, so an
 * interrupted turn honestly shows the user's words and nothing else.
 * Item payloads are the wire items verbatim (JSON); excerpt is derived
 * on read, never stored.
 */

import { randomUUID } from "node:crypto";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";
import type {
  ChatIntent,
  ChatItem,
  ChatSessionView,
  ChatTurnPage,
  ChatTurnView,
} from "./types.ts";

const CHAT_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_turns (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      card_outcome TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns (session_id, seq)`,
    `CREATE TABLE IF NOT EXISTS chat_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_items_turn ON chat_items (turn_id, seq)`,
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR(36) PRIMARY KEY,
      created_at VARCHAR(32) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_turns (
      seq INT PRIMARY KEY AUTO_INCREMENT,
      id VARCHAR(36) NOT NULL UNIQUE,
      session_id VARCHAR(36) NOT NULL,
      intent VARCHAR(8) NOT NULL,
      card_outcome VARCHAR(32),
      created_at VARCHAR(32) NOT NULL,
      KEY idx_chat_turns_session (session_id, seq)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      turn_id VARCHAR(36) NOT NULL,
      seq INT NOT NULL,
      payload TEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      KEY idx_chat_items_turn (turn_id, seq)
    )`,
  ],
};

export interface StoredTurn {
  readonly id: string;
  readonly intent: ChatIntent;
  readonly card_outcome?: string;
  readonly created_at: string;
  readonly items: readonly ChatItem[];
}

export interface ChatStore {
  /** The single ongoing conversation, created on first call. */
  ensureSession(): Promise<{ id: string; created_at: string }>;
  createSession(): Promise<{ id: string; created_at: string }>;
  /** Persists the turn with its user message item — before any AI call. */
  appendUserTurn(
    sessionId: string,
    userItem: ChatItem,
  ): Promise<{ id: string; created_at: string }>;
  /** Replaces the provisional intent once routing settles. */
  setTurnIntent(turnId: string, intent: ChatIntent): Promise<void>;
  /** Appends the reply items in order, one transaction. */
  completeTurn(turnId: string, items: readonly ChatItem[]): Promise<void>;
  /** Records a card's final state (display metadata only). */
  setCardOutcome(turnId: string, outcome: string): Promise<void>;
  getTurn(turnId: string): Promise<StoredTurn | undefined>;
  /**
   * One page of turns, oldest → newest inside the window: `before` is the
   * seq cursor (a turn id) paging back in time; `next_before` is absent
   * at the beginning.
   */
  listTurns(
    sessionId: string,
    options: { limit: number; before?: string },
  ): Promise<ChatTurnPage>;
  /** Sessions newest first, excerpt derived from each one's latest turn. */
  listSessions(): Promise<readonly ChatSessionView[]>;
  /** Deletes one session with all its turns and items, one transaction. */
  deleteSession(id: string): Promise<boolean>;
  close(): Promise<void>;
}

interface TurnRow {
  readonly seq: number;
  readonly id: string;
  readonly session_id: string;
  readonly intent: string;
  readonly card_outcome: string | null;
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

export function createChatStore(deps: {
  config: TobyConfig;
  clock: Clock;
}): ChatStore {
  const { config, clock } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function db(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("chat store is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "chat");
      for (const statement of CHAT_SCHEMA[handle.dialect]) {
        await handle.exec(statement);
      }
      return handle;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
    return opening;
  }

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
      ...(row.card_outcome !== null ? { card_outcome: row.card_outcome } : {}),
      created_at: row.created_at,
      items,
    };
  }

  return {
    async ensureSession() {
      const handle = await db();
      const existing = await handle.query<{ id: string; created_at: string }>(
        "SELECT id, created_at FROM chat_sessions ORDER BY created_at DESC, id DESC LIMIT 1",
      );
      if (existing.length > 0) {
        return existing[0]!;
      }
      return createSessionRow(handle, clock);
    },

    async createSession() {
      const handle = await db();
      return createSessionRow(handle, clock);
    },

    async appendUserTurn(sessionId, userItem) {
      const handle = await db();
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
      const handle = await db();
      await handle.run("UPDATE chat_turns SET intent = ? WHERE id = ?", [
        intent,
        turnId,
      ]);
    },

    async completeTurn(turnId, items) {
      const handle = await db();
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

    async setCardOutcome(turnId, outcome) {
      const handle = await db();
      await handle.run("UPDATE chat_turns SET card_outcome = ? WHERE id = ?", [
        outcome,
        turnId,
      ]);
    },

    async getTurn(turnId) {
      const handle = await db();
      const rows = await handle.query<TurnRow>(
        "SELECT seq, id, session_id, intent, card_outcome, created_at FROM chat_turns WHERE id = ?",
        [turnId],
      );
      const row = rows[0];
      if (!row) {
        return undefined;
      }
      const items = (await itemsOfTurns(handle, [row.id])).get(row.id) ?? [];
      return {
        id: row.id,
        intent: isIntent(row.intent) ? row.intent : "none",
        ...(row.card_outcome !== null
          ? { card_outcome: row.card_outcome }
          : {}),
        created_at: row.created_at,
        items,
      };
    },

    async listTurns(sessionId, options) {
      const handle = await db();
      // The cursor is a turn id; resolve it to its seq position first.
      let beforeSeq: number | undefined;
      if (options.before !== undefined) {
        const cursor = await handle.query<{ seq: number }>(
          "SELECT seq FROM chat_turns WHERE id = ? AND session_id = ?",
          [options.before, sessionId],
        );
        beforeSeq = cursor[0]?.seq;
      }
      const descending = await handle.query<TurnRow>(
        `SELECT seq, id, session_id, intent, card_outcome, created_at FROM chat_turns
         WHERE session_id = ? ${beforeSeq !== undefined ? "AND seq < ?" : ""}
         ORDER BY seq DESC LIMIT ?`,
        beforeSeq !== undefined
          ? [sessionId, beforeSeq, options.limit]
          : [sessionId, options.limit],
      );
      const ascending = [...descending].reverse();
      const byTurn = await itemsOfTurns(
        handle,
        ascending.map((row) => row.id),
      );
      const olderThanWindow = await handle.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM chat_turns WHERE session_id = ? ${beforeSeq !== undefined ? "AND seq < ?" : ""}`,
        beforeSeq !== undefined ? [sessionId, beforeSeq] : [sessionId],
      );
      const remaining = olderThanWindow[0]?.count ?? 0;
      return {
        turns: ascending.map((row) => toView(row, byTurn.get(row.id) ?? [])),
        // There is more history beyond this page exactly when older turns
        // exist below the window's oldest row.
        ...(remaining > ascending.length
          ? {
              next_before: ascending[0]?.id,
            }
          : {}),
      };
    },

    async listSessions() {
      const handle = await db();
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

    async deleteSession(id) {
      const handle = await db();
      return handle.transaction(async (tx) => {
        const found = await tx.query<{ id: string }>(
          "SELECT id FROM chat_sessions WHERE id = ?",
          [id],
        );
        if (found.length === 0) {
          return false;
        }
        await tx.run(
          "DELETE FROM chat_items WHERE turn_id IN (SELECT id FROM chat_turns WHERE session_id = ?)",
          [id],
        );
        await tx.run("DELETE FROM chat_turns WHERE session_id = ?", [id]);
        await tx.run("DELETE FROM chat_sessions WHERE id = ?", [id]);
        return true;
      });
    },

    async close() {
      closed = true;
      const handle = await opening?.catch(() => undefined);
      await handle?.close();
      opening = undefined;
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
