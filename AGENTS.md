# Toby Agent Guide

English | [简体中文](AGENTS.zh.md)

Instructions for AI coding agents working in this repository.

> **Current status: framework phase.** The command tables and directory layout below describe the target state once the framework lands; until then, `PLAN.md` is authoritative.

## Project overview

Self-hosted personal assistant: the user says one sentence, the AI drafts a constrained proposal, the user confirms, and only then the server writes. Product: [README.md](README.md) · architecture: [docs/system-overview.md](docs/system-overview.md) · per-domain contracts: [docs/features/](docs/features/).

Before implementing: find the currently authoritative doc (feature docs + ADRs) in `docs/features/` and `docs/decisions/` — do not trust memory; check for an existing implementation — do not build a parallel one.

## Commands

All from the repo root:

| Command                            | What it does                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `pnpm run dev`                     | Start dev: server 8629 → web 8630 / web-mobile 8631                |
| `pnpm run start`                   | Production: build webs, single server process serves pages and API |
| `pnpm run check`                   | Full check: typecheck / lint / format / test                       |
| `pnpm run typecheck`               | Type checks only                                                   |
| `pnpm run lint`                    | ESLint only (including boundary rules)                             |
| `pnpm run format` / `format:check` | Prettier format / check                                            |
| `pnpm run test`                    | All tests (per-package + root HTTP integration tests)              |
| `pnpm run build`                   | Build both web apps                                                |

Ports, processes, and deployment details live in `docs/operations/` — not repeated here.

## Testing conventions

- Tests use temporary data directories and fake AI / logger implementations; production data is never touched, not one byte.
- Automated tests never call real AI, never deploy remotely, never write production data. Running any of those requires explicit authorization in the task, and their results are reported separately from local automation.
- What you changed is what you run:

| Change                                                                | Must run                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/` code                                                   | `pnpm run test` (domain tests + root integration tests)                         |
| `apps/web/`, `apps/web-mobile/`, `packages/contract/`, `packages/ui/` | `pnpm run test` + `pnpm run typecheck`                                          |
| TS/JS sources or ESLint/Prettier config                               | `pnpm run lint`, `pnpm run format:check`                                        |
| `package.json`, lockfile, workspace config                            | `pnpm install --frozen-lockfile`, `pnpm run check`                              |
| `Dockerfile` / `compose.yaml` / `.dockerignore`                       | `docker compose build && docker compose up -d`; healthcheck must report healthy |
| Markdown or document paths                                            | Check links and old path references in affected docs; run `git diff --check`    |

If one change touches several rows, run all the checks those rows list.

## Project structure

- `apps/server/` — single server process; composition root `src/main.ts`; vertical domain slices under `src/domains/<domain>/`.
- `apps/web/` (PC, served at `/`) and `apps/web-mobile/` (mobile, `/m/`) — two React SPAs; they never import each other.
- `packages/contract/` (pure logic) and `packages/ui/` (pure components) — the only cross-app sharing path.
- Dependency direction is always `apps → packages`: packages never import apps; the web apps never import `@toby/server`.
- Domains never import each other; cross-domain wiring happens only in the composition root. `infrastructure/` never imports business domains; a domain's `types.ts` stays pure (no fastify / infrastructure / `node:` imports).
- These boundaries are machine-enforced by ESLint `no-restricted-imports`; a violation fails the build.
- `data/` holds the runtime SQLite databases.

## Code style

- `.ts` sources run directly on Node 22 with no build step. No `enum` / `namespace` / constructor parameter properties; use `import type` (`erasableSyntaxOnly` catches violations automatically).
- No Python; introducing it requires an ADR first.
- Formatting and lint gates: Prettier + ESLint, run via `pnpm run check`.

## Git workflow

- AI never commits, pushes, or rewrites history on its own: show the user the exact changes and the full commit message first and get explicit approval. Approval of a plan does not cover individual commits.
- Run `git status --short` before starting — never touch or revert uncommitted changes that are not yours.
- Commit messages and code comments in **English**; Conventional Commits with English scopes (e.g. `feat(schedule): add month view`).
- Commits are a single subject line: no body paragraphs, no trailers such as Co-Authored-By.
- Everything merged into `main` goes through a PR: feature branch → all four CI checks (lint / typecheck / test / docker) green → squash merge.
- Update the matching `docs/features/` document only when a contract changes; pure implementation changes do not touch it. Architecture changes come with a new ADR in `docs/decisions/`. Progress is tracked by commit history.

## Boundaries and security

- Everything under `data/` is production data. Nobody touches it by default; only maintenance tasks the user explicitly names may touch it. Before and after moving or restoring data, compare **SHA-256** checksums.
- Only the server (`apps/server`) writes to the databases. Web, AI, and scripts never connect to a database directly.
- Every create/update/delete goes through the "AI proposal → user confirmation → server transactional write" pipeline; any write endpoint that bypasses it is a defect. The AI produces field values only: no database, no shell, no file paths, no tool calls.
- API keys, tokens, certificate private keys, server credentials, personal sensitive data, full production logs: never enter source code, docs, tests, snapshots, or commits — nowhere.
- If code and docs disagree and the conflict involves data / security / public interfaces: stop and ask the user; do not pick a side yourself.
