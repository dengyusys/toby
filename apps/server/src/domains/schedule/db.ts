/**
 * The schedule database's lifecycle: open lazily once per process, apply
 * the schema, close on shutdown, memoized per process. The SQL read/write
 * layer over it lives in repository.ts.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";

/**
 * Idempotent DDL, applied on every open. SQLite needs a separate index
 * statement; MySQL declares the key inside the table (`CREATE INDEX` has no
 * `IF NOT EXISTS` there). The natural key (item_id, date) carries a UNIQUE
 * constraint: one entry per item per day, enforced by the store itself.
 */
const SCHEDULE_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS schedule_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      statuses TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (item_id, date)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_schedule_entries_item ON schedule_entries (item_id)",
    `CREATE TABLE IF NOT EXISTS schedule_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL
    )`,
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS schedule_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(50) NOT NULL UNIQUE,
      statuses TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schedule_entries (
      id INT PRIMARY KEY AUTO_INCREMENT,
      item_id INT NOT NULL,
      date CHAR(10) NOT NULL,
      status VARCHAR(30) NOT NULL,
      updated_at VARCHAR(32) NOT NULL,
      UNIQUE KEY uq_schedule_entries_item_date (item_id, date),
      KEY idx_schedule_entries_item (item_id)
    )`,
    `CREATE TABLE IF NOT EXISTS schedule_views (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(60) NOT NULL,
      type VARCHAR(16) NOT NULL,
      config TEXT NOT NULL
    )`,
  ],
};

export interface ScheduleDb {
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

export function createScheduleDb(deps: { config: TobyConfig }): ScheduleDb {
  const { config } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function open(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("schedule db is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "schedule");
      for (const statement of SCHEDULE_SCHEMA[handle.dialect]) {
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
