# Toby Agent Guide

English | [简体中文](AGENTS.zh.md)

Instructions for AI coding agents working in this repository.

> **Current status:** live domains are whatever sits in `apps/server/src/domains/`; `docs/features/` holds the target contracts (not a landing marker) and `docs/decisions/` the ADRs. `PLAN.md` stays as the framework-era plan, its version matrix still the source of truth for the pnpm catalog (the workspace's centralized version table).

## Project overview

Self-hosted personal assistant: the user says one sentence, the AI drafts a constrained proposal, the user confirms, and only then the server writes. Product: [README.md](README.md) · architecture: [docs/system-overview.md](docs/system-overview.md) · per-domain contracts: [docs/features/](docs/features/).

Before implementing: find the currently authoritative doc (feature docs + ADRs) in `docs/features/` and `docs/decisions/` — do not trust memory; check for an existing implementation — do not build a parallel one.

## Commands

All from the repo root:

| Command                            | What it does                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm run dev`                     | Start dev: server 8629 → web 8630 / web-mobile 8631                                         |
| `pnpm run start`                   | Production: build webs + server, run `dist/main.js` (single process serves pages and API)   |
| `pnpm run check`                   | Full check: typecheck / lint / format / test                                                |
| `pnpm run typecheck`               | Type checks only                                                                            |
| `pnpm run lint`                    | ESLint only (code-quality rules)                                                            |
| `pnpm run format` / `format:check` | Prettier format / check                                                                     |
| `pnpm run test`                    | All tests (builds the server first; per-package + root HTTP integration and boundary tests) |
| `pnpm run build`                   | Build both web apps and the server (`nest build` → `dist/`)                                 |

Ports, processes, and deployment details live in `docs/operations/` — not repeated here.

## Testing conventions

- Tests use temporary data directories and fake AI / logger implementations; production data is never touched, not one byte.
- Automated tests never call real AI, never deploy remotely, never write production data. Running any of those requires explicit authorization in the task, and their results are reported separately from local automation.
- What you changed is what you run:

| Change                                                | Must run                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/server/` code                                   | `pnpm run test` (domain tests + root integration tests)                      |
| `apps/web/`, `apps/web-mobile/`, `packages/contract/` | `pnpm run test` + `pnpm run typecheck`                                       |
| TS/JS sources or ESLint/Prettier config               | `pnpm run lint`, `pnpm run format:check`                                     |
| `package.json`, lockfile, workspace config            | `pnpm install --frozen-lockfile`, `pnpm run check`                           |
| Markdown or document paths                            | Check links and old path references in affected docs; run `git diff --check` |

If one change touches several rows, run all the checks those rows list.

## Project structure

- `apps/server/` — single server process; composition root `src/main.ts`; vertical domain slices under `src/domains/<domain>/`. Each domain registers its wire error codes in a closed union in `src/domains/<domain>/errors.ts` — add new codes there and in the web clients, nowhere else.
- `apps/web/` (PC, served at `/`) and `apps/web-mobile/` (mobile, `/m/`) — two React SPAs; they never import each other.
- `packages/contract/` (pure logic) — the only cross-app sharing path; components and styles are owned by each app and never shared.
- Dependency direction is always `apps → packages`: packages never import apps; the web apps never import `@toby/server`.
- Domains never import each other; cross-domain wiring happens only in the composition root. `infrastructure/` never imports business domains; a domain's `types.ts` stays pure (no fastify / infrastructure / `node:` imports).
- These boundaries are machine-enforced by the import-boundary tests in `test/boundaries.test.ts`; a violation fails the build.
- `data/` holds the runtime SQLite databases.

## Code style

- `apps/web`, `apps/web-mobile`, `packages`: `.ts` runs on Node 22 with no build step — no `enum` / `namespace` / constructor parameter properties; use `import type` (`erasableSyntaxOnly` enforces this).
- `apps/server`: built with `nest build`; decorators, `emitDecoratorMetadata`, constructor parameter properties and Nest idioms are allowed there — but tests run through vitest's transform, which emits no decorator metadata, so prefer `@Inject(token)` property injection (see `docs/decisions/nestjs-server-stack.md`).
- No Python; introducing it requires an ADR first.

## Git workflow

- AI never commits, pushes, or rewrites history on its own: show the user the exact changes and the full commit message first and get explicit approval. Approval of a plan does not cover individual commits.
- Run `git status --short` before starting — never touch or revert uncommitted changes that are not yours.
- Commit messages and code comments in **English**; Conventional Commits with English scopes (e.g. `feat(schedule): add month view`).
- Commits are a single subject line: no body paragraphs, no trailers such as Co-Authored-By.
- Changes land on `main` by direct push: run `pnpm run check` locally and make it green before pushing. CI runs the same four checks on every push to `main` and every pull request as a post-hoc safety net; dependabot's upgrade PRs are the only PRs. Larger migrations may run on a `feat/*` branch and merge back locally before pushing.
- Documentation is bilingual: every change to a doc applies to both the English file and its `.zh.md` mirror in the same change.
- Update the matching `docs/features/` document only when a contract changes; pure implementation changes do not touch it. Architecture changes come with a new ADR in `docs/decisions/`. Progress is tracked by commit history.

## Boundaries and security

- Everything under `data/` is production data. Nobody touches it by default; only maintenance tasks the user explicitly names may touch it. Before and after moving or restoring data, compare **SHA-256** checksums.
- Only the server (`apps/server`) writes to the databases. Web, AI, and scripts never connect to a database directly.
- Every create/update/delete goes through the "AI proposal → user confirmation → server transactional write" pipeline; any write endpoint that bypasses it is a defect. AI tools are registered with a safety kind (read-only / write-intent — write-intent tools only produce proposals) and policy-gated; prohibited capabilities (database, shell, file paths) are absent as tool definitions. See docs/decisions/ai-pi-runtime.md.
- API keys, tokens, certificate private keys, server credentials, personal sensitive data, full production logs: never enter source code, docs, tests, snapshots, or commits — nowhere.
- If code and docs disagree and the conflict involves data / security / public interfaces: stop and ask the user; do not pick a side yourself.
