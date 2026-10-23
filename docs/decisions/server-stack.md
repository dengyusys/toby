# Why the Server Runs This Stack

> **Superseded by [nestjs-server-stack.md](nestjs-server-stack.md)** (2026-10-23): the server now runs NestJS 12 over the same Fastify engine. The sections below still hold (Fastify, SQLite, pino); the "Not NestJS" line and the zero-build framing are historical.

English | [简体中文](server-stack.zh.md)

## The core idea

One criterion governs every choice: **a self-hosted, single-user, single-process personal project — everything yields to simple and controllable.**

One less process, one less framework layer — whenever possible.

## Fastify

The HTTP framework is Fastify: **small, fast, with a straightforward plugin model.**

- The everyday necessities are built in: JSON parsing, schema validation, error handling, route organization — no assembling piece by piece
- Static files, cookies, and the like mount as plugins on demand; the core stays clean
- Not Express — too bare; error handling and validation would be DIY
- Not NestJS — superseded 2026-10-23: the server now runs NestJS over the Fastify adapter (see [nestjs-server-stack.md](nestjs-server-stack.md))

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

## typebox

**One schema library, one definition.** (The earlier zod section described
an aspiration — zod was never actually installed; validation was
hand-written. typebox makes the promise real, chosen with the AI runtime —
see [ai-pi-runtime.md](ai-pi-runtime.md).)

- Foreign data (AI output, HTTP bodies, environment variables) is trusted
  only after validation; schemas are defined once and shared — the ledger
  draft schema is simultaneously the model-facing tool contract and the
  server's shape gate, so the two can never drift.
- TypeBox schemas _are_ JSON Schema: the model-facing contract and the
  runtime check come from one definition, with `typebox/value`'s
  `Check`/`Errors` on the validation side.
- Validation failures point at the offending path, no guessing; the same
  error text can be fed back to the model as a tool error.

## pino

**Structured logging: fast, JSON output, sufficient.**

- Every log line is an object with fields — filter by field when debugging, no regex-gnawing text
- Low overhead, never drags a request down
- The logs are for myself: no heavier observability suite — pino and stop

## Conventions in this repository

- Production is one process: the server serves both the API and the two frontends
- Foreign data (AI output, HTTP bodies) passes schema validation (typebox for the AI pipeline) before entering business logic
