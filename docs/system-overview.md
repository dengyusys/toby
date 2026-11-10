# System Architecture

English | [简体中文](system-overview.zh.md)

## Purpose

This document describes the repository's **module boundaries**, running processes, data flow, and dependency directions, at domain and process granularity.

Three documents, three layers: product scope is owned by the [Product Overview](product-overview.md); per-domain contracts and acceptance by the `docs/features/` docs; implementation details by code and tests.

## Stack

| Layer    | Choice                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | Node 22.23.2; server built with `tsc`, webs with Vite                                                                                                      |
| Packages | pnpm 11.18.0 workspaces (`apps/*` + `packages/*`)                                                                                                          |
| Server   | Fastify 5 + own db adapter port — "port" as in ports-and-adapters, not a network port — (SQLite default, MySQL optional) + zod (AI: pi-ai + pi-agent-core) |
| Web      | React 19 + Vite 8 + Tailwind v4 + shadcn, two apps (PC `/`, mobile `/m/`)                                                                                  |
| Tests    | vitest + happy-dom + @testing-library                                                                                                                      |

## System context

```mermaid
flowchart LR
    U(("User")) --> W["Two web apps (React SPAs:<br/>PC at / and mobile at /m/)"]
    W -->|"read-only APIs / write receipts (HTTP)"| S["Toby server · single process (Fastify)<br/>vertical domains · direct writes (one transaction each)"]
    S --> DB[("Databases via the adapter port<br/>SQLite (default) · MySQL (optional)<br/>only the server writes")]
    S -->|"kind-gated tools; writes are validated drafts"| AI(("AI via pi-ai / pi-agent-core"))
```

- The web apps reach data only through server APIs; they never touch the file system.
- The server is the only daily read/write entry: queries go through read-only APIs; every create/update/delete is one validated, transactional repository write — no proposals, no confirmation gates (ledger is live on it).
- AI tools carry a safety kind (read-only / write-intent) and run behind a policy gate; every write a tool produces is deterministic validation plus one transaction (docs/decisions/ai-pi-runtime.md).
- Root `scripts/` only orchestrates dev and multi-process startup; it never touches data.
- The remaining business domains (greeting, schedule, notes, todo, memory, library) land one at a time; each writes its contract doc in `docs/features/` when it lands — not before. The write rule is one sentence shared by all of them, not a shared module.

## Repository layout

```text
apps/
├─ server/        # @toby/server: Fastify single process — pages, APIs, validated writes
├─ web/           # @toby/web: PC app (entry /)
├─ web-mobile/    # @toby/web-mobile: mobile app (entry /m/)
packages/
├─ contract/      # @toby/contract: shared contract package for both apps (pure TS, zero JSX/CSS/DOM)
scripts/          # dev and multi-process orchestration (dev.js)
data/             # runtime data (domain databases and files), git-ignored, server-only writes
docs/             # product, architecture, ADRs, feature contracts, operations
test/             # root HTTP integration tests
```

- `apps/` holds independently runnable apps; the two web apps never import each other; cross-app sharing goes only through `@toby/contract` (pure logic).
- Dependency direction is always `apps → packages`: packages never import apps; web apps never import `@toby/server`.
- These boundaries are machine-enforced by the import-boundary tests in `test/boundaries.test.ts`; a violation fails the build.

## Runtime topology

### Development

`pnpm run dev` is orchestrated by `scripts/dev.js`: the server starts first; once ready it launches the two Vite dev servers. Vite exists only in dev — pages, hot reload, and the `/api` proxy; production has no Vite process. Dev ports (server 8629, webs 8630/8631) live in [docs/operations/local-dev.md](operations/local-dev.md); 8629 spells TOBY on a T9 keypad.

### Production or local preview

- `pnpm run start`: builds both web apps, then the server serves pages (`/` and `/m/`) and APIs from one process on `8629`.
- The server listens on loopback only by default; Docker binds `127.0.0.1:8629` only, with `./data` mounted as a volume.

## APIs and the write data flow (target shape)

One write, end to end (endpoint contracts are finalized in each domain's `features/` doc). Every write — additive or destructive — takes the same direct path:

```mermaid
sequenceDiagram
    autonumber
    participant W as Web (chat page)
    participant S as Toby server
    participant A as AI provider
    participant D as Database (adapter port)

    W->>S: one sentence (text, time, timezone)
    S->>A: parse request (instruction text only)
    A-->>S: schema-validated entry drafts (submit_entries)
    S->>S: schema, domain, and semantic validation
    alt the sentence cannot be resolved
        S-->>W: clarifying question, never a guess (nothing written)
    else validated draft
        S->>D: one transaction: write serially and commit
        S-->>W: receipt (what was written)
    end
```

Two non-inferable details: the AI's draft passes shape, domain, and semantic validation before anything is written — `validation.ts` is the trust boundary; and a wrong write is corrected by writing again or restoring from backup — there is no in-product undo, by design.

## Data boundaries

- `data/` is production data: nobody touches it by default; maintenance requires explicit user instruction, with SHA-256 compared before and after any move or restore.
- Daily reads go only through server APIs; daily writes only as one validated repository transaction each. Clients, AI, and scripts never connect to a database directly.
- Explicit `false` and numeric `0` are valid data, never treated as missing.
- The server edits field by field: `NULL` means missing, omitted on read; unrelated fields stay untouched.
- A multi-field commit is one database transaction; failure or interruption rolls back via the database. No user history and no in-product undo — deliberately; recovery is backup.
- Each domain owns one database — a SQLite file `data/<domain>.db`, or a MySQL schema `toby_<domain>` when that dialect is on (see the [db adapter decision](decisions/db-adapter.md)); databases are never shared across domains.

## Security and dependency direction

```mermaid
flowchart TB
    BOOT["composition-root.ts<br/>one line per domain; all cross-domain wiring lives here"]
    INFRA["infrastructure/<br/>config (TOBY_*) · http (body limits / error body / no-store / dual-SPA static)<br/>model (AI runtime) · db (adapter port: sqlite / mysql)"]
    DOM["domains/*<br/>business domains, landing one by one"]
    BOOT --> INFRA
    BOOT --> DOM
```

Domain organization discipline:

- Every domain under `domains/` contains its own plugin (self-assembly), routes, services, stores, and pure business files; **domains never import each other** — cross-domain wiring happens only in the composition root `apps/server/src/composition-root.ts`.
- A domain's `types.ts` stays pure: no HTTP adapter, no infrastructure, no `node:` imports.
- `infrastructure/` never imports business domains; database opening is provided by `infrastructure/db` and consumed by domain stores.
- Adding a business domain needs no rule registration — the boundary tests in `test/boundaries.test.ts` discover domains from the filesystem.

Security boundaries:

- HTTP write paths are one validated, transactional repository write each; any write that is not — a bypass, a two-step write, a partial write — is a defect.
- The AI gets no file paths, no data contents, and no shell; its tools are kind-gated, and a write-intent tool's effect is deterministic validation plus one transaction (docs/decisions/ai-pi-runtime.md). Secrets live only in local environment config, never inside web bundles.
- Introducing new runtimes (Python etc.) requires an ADR first.
- These import disciplines are machine-enforced by `test/boundaries.test.ts`.

## Layout evolution rules

- Re-evaluate in-domain layering or splitting when a domain exceeds 15 files; split single files past 400 lines by concern.
- Configuration is resolved once at startup by `infrastructure/config`'s `resolveConfig({ env })` (`TOBY_*` environment variables); no global config at import time — the entry passes it explicitly, tests inject their own `env`.
- Web/packages `.ts` runs on Node 22 with no build step; the server is built with plain `tsc`. Style rules per package: see AGENTS.md (`erasableSyntaxOnly` applies to every package, the server included).
- When adjusting layout, update this document and path references in affected docs in the same change; long-lived trade-offs get an ADR in `docs/decisions/`. The full maintenance rules live in the [living docs decision](decisions/living-docs.md).

## Glossary

Terms this repository uses with a specific meaning; one line each — the authoritative definition lives where the term is introduced.

| Term                           | Meaning                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| direct write                   | Every write — additive or destructive — is deterministic validation plus one transactional repository write; no proposals, no confirmation gates, no undo              |
| safety kind                    | A tool's registered class: `read-only` (no state change) or `write-intent` (real effect: a validated, transactional write); a `costly` kind is reserved for the future |
| gate (policy / shape / health) | Enforcement points: policy = tool kinds an agent may call; shape = Zod schema check; health = dev startup readiness                                                    |
| trust boundary                 | Deterministic server-side validation — the AI's output (and every other foreign input) is untrusted until it passes                                                    |
| adapter port                   | "Port" as in ports-and-adapters: the interface behind which SQLite / MySQL swap                                                                                        |
| composition root               | `apps/server/src/composition-root.ts` — the only place cross-domain wiring happens                                                                                     |
| vertical domain slice          | One business = one directory owning its routes, service, store, and rules                                                                                              |
| modular monolith               | Modules isolated in code, assembled and run by one process                                                                                                             |
| error body                     | The one error shape: `{ statusCode, message, error }` plus a machine-readable `errorCode` (the sanitized 500 keeps only `statusCode` and `message`)                    |
