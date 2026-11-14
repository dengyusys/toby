/**
 * The settings database's lifecycle: open lazily once per process, apply
 * the schema, close on shutdown, memoized per process. The SQL read/write
 * layer over it lives in repository.ts.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";

/**
 * Idempotent DDL, applied on every open. Two tables: key-value settings
 * rows and one credential row per provider (the JSON stays opaque here).
 */
const SETTINGS_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS settings (
      setting_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS provider_credentials (
      provider_id TEXT PRIMARY KEY,
      credential_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS provider_credentials (
      provider_id VARCHAR(64) PRIMARY KEY,
      credential_json TEXT NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    )`,
  ],
};

export interface SettingsDb {
  /**
   * The opened database, opened once. A failed open forgets the memo, so
   * a transient failure retries instead of bricking the domain. Once
   * closed, the database stays closed: a late caller gets an error,
   * never a fresh handle nobody would close.
   */
  open(): Promise<DomainDb>;
  /** Close, if it was ever opened; the database stays closed. */
  close(): Promise<void>;
}

export function createSettingsDb(deps: { config: TobyConfig }): SettingsDb {
  const { config } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function open(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("settings db is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "settings");
      for (const statement of SETTINGS_SCHEMA[handle.dialect]) {
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
