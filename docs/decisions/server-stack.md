# Why the Server Runs This Stack

English | [简体中文](server-stack.zh.md)

## The core idea

One criterion governs every choice: **a self-hosted, single-user, single-process personal project — everything yields to simple and controllable.**

One less process, one less framework layer — whenever possible.

## Fastify

The HTTP framework is Fastify: **small, fast, with a straightforward plugin model.**

- The everyday necessities are built in: JSON parsing, schema validation, error handling, route organization — no assembling piece by piece
- Static files, cookies, and the like mount as plugins on demand; the core stays clean
- Not Express — too bare; error handling and validation would be DIY
- Not NestJS — a personal project doesn't need the IoC-container and decorator ceremony

## The database: SQLite + better-sqlite3, plus a MySQL adapter

The database is SQLite — the best bargain in this whole stack — reached through the adapter port of [db-adapter](db-adapter.md). The same port also carries a MySQL adapter — an addition for learning, explained in the last block of this section.

**One file is one database.**

- No database service: no port, no connection config, no autostart, no version upgrades — one less thing that can break
- Backup is copying a file: the whole `data/` directory copied away is a complete backup; checksums, packaging, moving house — all file operations
- Data lives with the project: clearing `data/` is a clean restart, leaving no stray services in the system

**Synchronous API — a transaction is a function call.**

better-sqlite3 calls synchronously: no connection pool, no reconnect logic, no async races. A transaction is just a stretch of ordinary code wrapped in begin / commit. This fits the "confirm the proposal, then one transactional write" model perfectly: re-read targets, check conflicts, execute — atomic and reason-able as a whole. The database port puts an async-first face in front of this driver while keeping the same guarantee by serializing every operation.

**The well-known weakness does not exist here.**

SQLite's weakness is single-writer, poor fit for high concurrency. Toby has exactly one writer (the single server process), and writes all go through proposal confirmation — low-frequency and transactional, SQLite's most comfortable scenario by birth. Read-heavy, write-light; WAL mode keeps reads and writes from blocking each other. A single user's data volume doesn't scratch its capacity. SQLite is also one of the most thoroughly tested programs in existence — reliability is not in question.

**Why not MySQL / PostgreSQL — and why a MySQL adapter exists anyway.**

They require a daemon process: port, credentials, connection pool, backup tooling, upgrades — the operations surface doubles; the database password is yet another secret to guard. And what that cost buys — high concurrency, multi-app sharing, massive data volumes — this project uses none of. If multi-process writes or data volume ever become real, migrating later is fine: the data is in files, the migration path is clear.

Even so, the adapter port carries a MySQL adapter — added by the author for learning: to see how another dialect feels behind one interface, where SQL is portable, where it is not, and what a connection pool changes. If a third database ever joins, it is just one more adapter. SQLite stays the recommended database; MySQL is there to experiment with, not a requirement. Domain code never sees the difference: driver, pool, and dialect details all stop at the port.

## zod

**One definition, both runtime validation and type inference.**

- Foreign data (AI output, HTTP bodies, environment variables) is trusted only after validation — and the TypeScript types come along, no defining things twice
- Validation failures point at the offending field, no guessing
- In the AI pipeline it is the deterministic gate: whether the model's JSON conforms to the schema is decided here, not by the prompt

## pino

**Structured logging: fast, JSON output, sufficient.**

- Every log line is an object with fields — filter by field when debugging, no regex-gnawing text
- Low overhead, never drags a request down
- The logs are for myself: no heavier observability suite — pino and stop

## Conventions in this repository

- Production is one process: the server serves both the API and the two frontends
- Foreign data (AI output, HTTP bodies) passes zod validation before entering business logic
