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
 * single owner's password hash. There is no migration mechanism: a column
 * missing here cannot be added to an existing table later, so the table is
 * declared complete.
 */
const AUTH_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
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
