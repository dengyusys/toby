/**
 * MySQL adapter (mysql2): one schema per domain (`<prefix><domain>`, created
 * with CREATE DATABASE IF NOT EXISTS at startup), a small per-domain
 * connection pool, and transactions that check out one connection and pin
 * their body to it. The pool pins dateStrings + timezone "Z" so the driver
 * never converts date/time values — domains pass strings end to end. This
 * adapter exists for learning (feeling another dialect behind one port);
 * SQLite remains the recommended database.
 */

import { createConnection, createPool } from "mysql2/promise";
import { DbError, type DbErrorCode } from "../errors.ts";
import type {
  DbOperations,
  DbParam,
  DbRow,
  DbRunResult,
  DomainDb,
} from "../types.ts";

/** Connection target resolved from TOBY_DB_MYSQL_* configuration. */
export interface MySqlTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly databasePrefix: string;
}

// Covers both the pool and a checked-out connection without fighting the
// driver's generic signatures.
interface StatementExecutor {
  query(sql: string, values?: unknown): Promise<[unknown, unknown]>;
  execute(sql: string, values?: unknown): Promise<[unknown, unknown]>;
}

interface MySqlRunHeader {
  affectedRows: number;
  insertId: number;
}

const MYSQL_ERROR_CODES: Readonly<Record<string, DbErrorCode>> = {
  ER_DUP_ENTRY: "unique-violation",
  ER_NO_REFERENCED_ROW: "foreign-key-violation",
  ER_NO_REFERENCED_ROW_2: "foreign-key-violation",
  ER_ROW_IS_REFERENCED: "foreign-key-violation",
  ER_ROW_IS_REFERENCED_2: "foreign-key-violation",
  ER_BAD_NULL_ERROR: "constraint",
  ER_CHECK_CONSTRAINT_VIOLATED: "constraint",
  ER_DATA_TOO_LONG: "constraint",
  ER_NO_DEFAULT_FOR_FIELD: "constraint",
  ER_PARSE_ERROR: "syntax",
  ER_SYNTAX_ERROR: "syntax",
  ER_EMPTY_QUERY: "syntax",
  ER_LOCK_WAIT_TIMEOUT: "busy",
  ER_LOCK_DEADLOCK: "busy",
  ECONNREFUSED: "connection",
  ECONNRESET: "connection",
  EPIPE: "connection",
  ETIMEDOUT: "connection",
  ENOTFOUND: "connection",
  ER_ACCESS_DENIED_ERROR: "connection",
  ER_BAD_DB_ERROR: "connection",
  PROTOCOL_CONNECTION_LOST: "connection",
  POOL_CLOSED: "connection",
};

function mapMySqlError(error: unknown): DbError {
  if (error instanceof DbError) {
    return error;
  }
  const raw = error as { code?: unknown };
  const code =
    typeof raw?.code === "string" ? MYSQL_ERROR_CODES[raw.code] : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new DbError(code ?? "unknown", message, error);
}

function toDriverParams(params: readonly DbParam[] | undefined): unknown[] {
  if (!params) {
    return [];
  }
  return params.map((param) => {
    // The driver tolerates booleans, but pin 1/0 so both dialects bind the
    // same way; plain Uint8Array views become Buffers.
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

/** MySQL identifiers top out at 64 characters. */
const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;

export async function createMySqlDomainDb(
  target: MySqlTarget,
  domain: string,
): Promise<DomainDb> {
  const database = `${target.databasePrefix}${domain}`;
  if (!IDENTIFIER.test(database)) {
    throw new DbError("unknown", `invalid mysql database name: ${database}`);
  }

  const connectionOptions = {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
  };

  // Bootstrap from a database-less connection: the schema must exist before
  // the pool can select it.
  const bootstrap = await createConnection(connectionOptions).catch(
    (error: unknown) => {
      throw mapMySqlError(error);
    },
  );
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4`,
    );
  } catch (error) {
    throw mapMySqlError(error);
  } finally {
    await bootstrap.end();
  }

  // connectionLimit 2 per domain: nine domains stay far under any server's
  // connection budget.
  const pool = createPool({
    ...connectionOptions,
    database,
    connectionLimit: 2,
    dateStrings: true,
    timezone: "Z",
  });

  async function guard(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
    } catch (error) {
      throw mapMySqlError(error);
    }
  }

  function operationsFor(executor: StatementExecutor): DbOperations {
    return {
      exec: (sql) => guard(executor.query(sql)), // text protocol: DDL cannot be prepared
      query: <Row = DbRow>(sql: string, params?: readonly DbParam[]) =>
        executor
          .execute(sql, toDriverParams(params))
          .then(([rows]) => {
            if (!Array.isArray(rows)) {
              throw new DbError(
                "unknown",
                "query() expects a row-returning statement",
              );
            }
            return rows as Row[];
          })
          .catch((error: unknown) => {
            throw mapMySqlError(error);
          }),
      run: (sql: string, params?: readonly DbParam[]) =>
        executor
          .execute(sql, toDriverParams(params))
          .then(([result]) => {
            const header = result as unknown as MySqlRunHeader;
            return {
              changes: header.affectedRows,
              insertId: header.insertId || null,
            } satisfies DbRunResult;
          })
          .catch((error: unknown) => {
            throw mapMySqlError(error);
          }),
    };
  }

  const pooled = operationsFor(pool);

  return {
    dialect: "mysql",
    exec: pooled.exec,
    query: pooled.query,
    run: pooled.run,
    transaction: async <T>(body: (tx: DbOperations) => Promise<T>) => {
      const connection = await pool.getConnection().catch((error: unknown) => {
        throw mapMySqlError(error);
      });
      try {
        await guard(connection.beginTransaction());
        const result = await body(operationsFor(connection));
        await guard(connection.commit());
        return result;
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => guard(pool.end()),
  };
}
