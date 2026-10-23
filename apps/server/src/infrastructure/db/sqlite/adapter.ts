/**
 * SQLite adapter (better-sqlite3): one file per domain under the data root,
 * WAL for concurrent reads during writes, foreign_keys for integrity. The
 * driver is synchronous; this adapter wraps it async-first and serializes
 * every operation (whole transactions included) through an internal promise
 * queue, which is what gives the async port the raw driver's
 * one-operation-at-a-time guarantee: a transaction holds the queue for its
 * whole span, so no foreign await can slip statements into it. Transactions
 * are manual BEGIN/COMMIT/ROLLBACK — the driver's own .transaction() cannot
 * host an async body.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DbError, type DbErrorCode } from "../errors.ts";
import type {
  DbOperations,
  DbParam,
  DbRow,
  DbRunResult,
  DomainDb,
} from "../types.ts";

function codeForSqlite(code: string): DbErrorCode {
  if (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  ) {
    return "unique-violation";
  }
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return "foreign-key-violation";
  }
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return "constraint";
  }
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return "busy";
  }
  if (code === "SQLITE_SYNTAX") {
    return "syntax";
  }
  return "unknown";
}

function mapSqliteError(error: unknown): DbError {
  if (error instanceof DbError) {
    return error;
  }
  if (error instanceof Database.SqliteError) {
    return new DbError(codeForSqlite(error.code), error.message, error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DbError("unknown", message, error);
}

/** better-sqlite3 binds Buffers but not plain Uint8Array views, booleans never. */
function toDriverParams(
  params: readonly DbParam[] | undefined,
): (string | number | bigint | Buffer | null)[] {
  if (!params) {
    return [];
  }
  return params.map((param) => {
    if (typeof param === "boolean") {
      return param ? 1 : 0;
    }
    if (param instanceof Uint8Array) {
      return Buffer.isBuffer(param)
        ? param
        : Buffer.from(param.buffer, param.byteOffset, param.byteLength);
    }
    return param;
  });
}

export function createSqliteDomainDb(
  dataRoot: string,
  domain: string,
): DomainDb {
  const databasePath = path.join(dataRoot, `${domain}.db`);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  // Explicit over the driver's implicit default: busy-handling is a
  // deliberate choice, not an accident of the dependency.
  database.pragma("busy_timeout = 5000");

  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = tail.then(operation);
    // The tail itself never rejects: one failed operation must not poison
    // the queue for the ones behind it.
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function executeRaw(sql: string): void {
    try {
      database.exec(sql);
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  function selectRows<Row>(sql: string, params?: readonly DbParam[]): Row[] {
    try {
      return database.prepare(sql).all(...toDriverParams(params)) as Row[];
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  function modifyRows(sql: string, params?: readonly DbParam[]): DbRunResult {
    try {
      const result = database.prepare(sql).run(...toDriverParams(params));
      return {
        changes: result.changes,
        insertId: Number(result.lastInsertRowid),
      };
    } catch (error) {
      throw mapSqliteError(error);
    }
  }

  function transaction<T>(body: (tx: DbOperations) => Promise<T>): Promise<T> {
    return enqueue(async () => {
      executeRaw("BEGIN");
      // Bypasses the queue on purpose: the transaction already holds it.
      const tx: DbOperations = {
        exec: (sql) => {
          executeRaw(sql);
          return Promise.resolve();
        },
        query: <Row = DbRow>(sql: string, params?: readonly DbParam[]) =>
          Promise.resolve(selectRows<Row>(sql, params)),
        run: (sql: string, params?: readonly DbParam[]) =>
          Promise.resolve(modifyRows(sql, params)),
      };
      try {
        const result = await body(tx);
        executeRaw("COMMIT");
        return result;
      } catch (error) {
        // A failing ROLLBACK must not mask the original error.
        try {
          executeRaw("ROLLBACK");
        } catch {
          // ignored on purpose
        }
        throw error;
      }
    });
  }

  return {
    dialect: "sqlite",
    exec: (sql: string) =>
      enqueue(() => {
        executeRaw(sql);
      }),
    query: <Row = DbRow>(sql: string, params?: readonly DbParam[]) =>
      enqueue(() => selectRows<Row>(sql, params)),
    run: (sql: string, params?: readonly DbParam[]) =>
      enqueue(() => modifyRows(sql, params)),
    transaction,
    close: () =>
      enqueue(() => {
        database.close();
      }),
  };
}
