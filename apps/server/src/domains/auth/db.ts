/**
 * The auth database: `data/auth.db` on SQLite, `<prefix>auth` on MySQL. Opened
 * lazily once per process, schema applied on every open; the SQL layer lives
 * in repository.ts.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";

/**
 * Idempotent DDL, applied on every open. `owner` holds exactly one row — the
 * single owner's password hash. `access_tokens` holds one row per access
 * token, never the secret: a SHA-256 digest to look up and the tail to show.
 * There is no migration mechanism: a column missing here cannot be added to
 * an existing table later, so both tables are declared complete.
 */
const AUTH_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS access_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_digest TEXT NOT NULL,
      token_last4 TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS access_tokens_token_digest
      ON access_tokens (token_digest)`,
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS access_tokens (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(64) NOT NULL,
      token_digest VARCHAR(64) NOT NULL,
      token_last4 VARCHAR(8) NOT NULL,
      scopes_json VARCHAR(255) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      last_used_at VARCHAR(32) NULL,
      expires_at VARCHAR(32) NULL,
      revoked_at VARCHAR(32) NULL,
      UNIQUE KEY access_tokens_token_digest (token_digest)
    )`,
  ],
};

export interface AuthDb {
  /**
   * The opened database, opened once. A failed open forgets the memo, so a
   * transient failure retries instead of bricking the domain. Once closed,
   * the database stays closed: a late caller gets an error, never a fresh
   * handle nobody would close.
   */
  open(): Promise<DomainDb>;
  close(): Promise<void>;
}

export function createAuthDb(deps: { config: TobyConfig }): AuthDb {
  const { config } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function open(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("auth db is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "auth");
      for (const statement of AUTH_SCHEMA[handle.dialect]) {
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
