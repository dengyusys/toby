# Database Adapter Design

English | [简体中文](db-adapter.zh.md)

The server reaches its databases through one thin, async-first port of our own — **no ORM, no query builder.** Domains keep writing SQL by hand in their `store.ts`; which dialect the server talks to — SQLite by default, or MySQL through its adapter — is a configuration choice, not a code choice. The port is open-ended: SQLite and MySQL are simply the adapters that exist today — a third database joins by implementing the same interface, and nothing else moves.

**The reason: the abstraction we need is small, and the part an ORM would sell us does not exist here.**

Connecting, executing parameterized statements, and wrapping a transaction amount to roughly a hundred lines per driver. The hard part — dialect differences — stays anyway: each domain owns its storage, so queries are hand-written regardless. Type safety is maintained by the domains themselves, through typed row interfaces and mappers in `store.ts`.

With [server-stack](server-stack.md): SQLite is the recommended database; the MySQL adapter exists for learning — to feel another dialect behind one interface.

## The port

```ts
export type DbDialect = "sqlite" | "mysql";
export type DbParam = string | number | bigint | boolean | null | Uint8Array;
export type DbRow = Record<string, unknown>;

export interface DbRunResult {
  changes: number; // sqlite `.changes` / mysql `affectedRows`
  insertId: number | null; // rowid / AUTO_INCREMENT; meaningful only after INSERT
}

export interface DbOperations {
  exec(sql: string): Promise<void>; // one raw statement, no params (DDL)
  query<Row = DbRow>(sql: string, params?: readonly DbParam[]): Promise<Row[]>;
  run(sql: string, params?: readonly DbParam[]): Promise<DbRunResult>;
}

export interface DomainDb extends DbOperations {
  readonly dialect: DbDialect;
  transaction<T>(body: (tx: DbOperations) => Promise<T>): Promise<T>; // commit on resolve, roll back on reject
  close(): Promise<void>;
}
```

`Row` is deliberately unconstrained: a constrained `<Row extends Record<string, unknown>>` would reject the caller's `interface` row types, because interfaces carry no implicit index signatures.

## Design conventions

- **Where it lives:** `infrastructure/db/` — the port in `types.ts` (zero driver imports), error mapping in `errors.ts`, one adapter per dialect (`sqlite/`, `mysql/`), the per-domain factory `createDomainDb(config, domain)` in `create-db.ts`, and a minimal `migrate.ts`. Domain `store.ts` imports only the port types; a domain's `types.ts` stays pure.
- **Positional `?` placeholders only.** Both drivers accept them natively. Named placeholders and array-binding for `IN` lists are forbidden — expand `IN` lists manually.
- **One error type.** Adapters map driver errors to a single `DbError` with a closed code union (`unique-violation | foreign-key-violation | constraint | syntax | busy | connection | unknown`) and keep the raw error as `cause`. Raw driver errors never cross the port.
- **One database per domain, as before.** SQLite dialect: one file `data/<domain>.db`. MySQL dialect: one schema `toby_<domain>`, created with `CREATE DATABASE IF NOT EXISTS … CHARACTER SET utf8mb4` at startup. Databases are never shared across domains.
- **Transactions are first-class**, because the proposal pipeline's commit step — re-read targets, check conflicts, write serially — is exactly one transaction.
  - SQLite adapter: manual `BEGIN` / `COMMIT` / `ROLLBACK` (better-sqlite3's synchronous `.transaction()` cannot host an async body), with **every operation serialized through an internal promise queue** — a transaction holds the queue for its whole span, so no foreign `await` can slip statements into it.
  - MySQL adapter: a small per-domain connection pool; a transaction checks out one connection and pins its body to it.
  - Rule for both: inside a transaction body, only await port methods.
- **Normalized results:** `changes` and `insertId` mean the same thing in both dialects (`Number(lastInsertRowid)` / `insertId || null`). Booleans are normalized by domain mappers (`row.done === 1`) — neither driver returns real booleans.
- **Time is UTC strings end to end.** Domains pass strings, never `Date` objects; the MySQL pool pins `dateStrings: true` and `timezone: "Z"` so the driver never converts. Money stays integer cents (`INTEGER` / `INT`) — no DECIMAL, no floats.
- **Identifiers are lowercase.** Writing to the portable-SQL subset is a discipline; dialect-specific SQL stays inside one domain's `store.ts` with a comment.
- **Migrations are code, not tooling.** A minimal `schema_version` table plus a forward-only ordered list of statements per domain, applied through the port at startup. No down migrations, no migration CLI. MySQL DDL auto-commits, so a migration batch is atomic on SQLite but not on MySQL — DDL leans on `IF NOT EXISTS` habits.
- **Configuration:** `TOBY_DB_DIALECT` (`sqlite` by default; `mysql` to switch) plus `TOBY_DB_MYSQL_HOST / _PORT / _USER / _PASSWORD / _DATABASE_PREFIX` (defaults `127.0.0.1`, `3306`, `toby`, empty, `toby_`), resolved once at startup by `infrastructure/config`.
- **Testing rule:** `pnpm run test` never requires a running MySQL. MySQL adapter tests are gated on `TOBY_TEST_MYSQL_URL` and skip by default.

## What we accept

- Everything at the port level is async-first. On the SQLite side, the serialization queue gives the adapter the same one-operation-at-a-time guarantee the raw synchronous driver has.
- MySQL's operations surface — daemon, credentials, per-schema backups — is real wherever MySQL runs, and this project needs none of it: the adapter is a learning device, not a deployment requirement. SQLite remains the recommended database.
- Where SQL cannot be shared across dialects (DDL, dialect specifics), it is written once per dialect. At this project's scale that duplication is cheap; if it ever stops being cheap, reopen this record.

This design trades ORM convenience for a dependency-free seam we fully understand — the same criterion that governs the rest of the stack.

> Framework-phase reservation: the design is settled here; the implementation batch is tracked in `PLAN.md`.
