/**
 * The ledger database's lifecycle: open lazily once per process, apply
 * the schema, close on shutdown, memoized per process. The SQL read/write
 * layer over it lives in repository.ts.
 */

import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { createDomainDb } from "../../infrastructure/db/create-db.ts";
import type { DbDialect, DomainDb } from "../../infrastructure/db/types.ts";

/**
 * Idempotent DDL, applied on every open. SQLite needs a separate index
 * statement; MySQL declares the key inside the table (`CREATE INDEX` has no
 * `IF NOT EXISTS` there).
 */
const LEDGER_SCHEMA: Record<DbDialect, readonly string[]> = {
  sqlite: [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      account TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date)",
  ],
  mysql: [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      date CHAR(10) NOT NULL,
      type VARCHAR(7) NOT NULL,
      category VARCHAR(24) NOT NULL,
      account VARCHAR(24) NOT NULL,
      amount BIGINT NOT NULL,
      note VARCHAR(200) NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      KEY idx_transactions_date (date)
    )`,
  ],
};

export interface LedgerDb {
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

export function createLedgerDb(deps: { config: TobyConfig }): LedgerDb {
  const { config } = deps;
  let opening: Promise<DomainDb> | undefined;
  let closed = false;

  function open(): Promise<DomainDb> {
    if (closed) {
      return Promise.reject(new Error("ledger db is closed"));
    }
    opening ??= (async () => {
      const handle = await createDomainDb(config, "ledger");
      for (const statement of LEDGER_SCHEMA[handle.dialect]) {
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
