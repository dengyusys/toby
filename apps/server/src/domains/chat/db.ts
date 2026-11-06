/**
 * The chat database's lifecycle (data/chat.db on SQLite, toby_chat on
 * MySQL): open lazily once per process, apply the schema, close on
 * shutdown. The SQL read/write layer over it lives in repository.ts.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";

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

export interface ChatDb {
  /**
   * The opened database, opened once. A failed open forgets the memo, so
   * a transient failure retries instead of bricking the domain.
   */
  open(): Promise<DomainDb>;
  /** Close, if it was ever opened; the database stays closed. */
  close(): Promise<void>;
}

export function createChatDb(deps: { config: TobyConfig }): ChatDb {
  const { config } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function open(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("chat db is closed"));
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

  return {
    open,
    async close() {
      closed = true;
      const handle = await opening?.catch(() => undefined);
      await handle?.close();
      opening = undefined;
    },
  };
}
