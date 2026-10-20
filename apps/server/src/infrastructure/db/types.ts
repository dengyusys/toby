/**
 * The database port (docs/decisions/db-adapter.md): one thin, async-first
 * interface every domain store talks to. No ORM, no query builder — domains
 * hand-write SQL, and which dialect answers is a configuration choice. This
 * file is the contract and stays free of driver imports.
 */

/** Dialects the server can talk to; a new database joins by adding an adapter. */
export type DbDialect = "sqlite" | "mysql";

/** Parameter values accepted by positional `?` placeholders. */
export type DbParam = string | number | bigint | boolean | null | Uint8Array;

/** A row as drivers return it: string keys, unknown values. */
export type DbRow = Record<string, unknown>;

export interface DbRunResult {
  /** sqlite `.changes` / mysql `affectedRows`. */
  changes: number;
  /** rowid / AUTO_INCREMENT; meaningful only after INSERT. */
  insertId: number | null;
}

export interface DbOperations {
  /** One raw statement, no parameters (DDL); exactly one statement per call. */
  exec(sql: string): Promise<void>;
  query<Row = DbRow>(sql: string, params?: readonly DbParam[]): Promise<Row[]>;
  run(sql: string, params?: readonly DbParam[]): Promise<DbRunResult>;
}

export interface DomainDb extends DbOperations {
  readonly dialect: DbDialect;
  /**
   * Run the body inside a transaction: commit on resolve, roll back on
   * reject. Inside the body, only await port methods on the given `tx`.
   */
  transaction<T>(body: (tx: DbOperations) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
