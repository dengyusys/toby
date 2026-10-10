# Toby Documentation

English | [简体中文](README.zh.md)

One sentence: **a self-hosted personal assistant** — you say one sentence in a chat box, the AI generates a constrained proposal, you confirm, and only then does the server write. The full write path is described in the [Product Overview](product-overview.md).

## Where we are

Framework phase. So far only:

- Norms and docs (AGENTS / PLAN / README / the product overview)
- Placeholder directories: `apps/server`, `apps/web`, `apps/web-mobile`, `packages/contract`, `scripts`

Not yet: code, CI, Docker. Next step: build the skeleton following the commit sequence in `PLAN.md`.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node 22.23.2, runs `.ts` directly, no build step |
| Packages | pnpm 11.18.0 workspaces (`apps/*` + `packages/*`) |
| Server | Fastify 5 + better-sqlite3 + pino + zod |
| Web | React 19 + Vite 6 + Tailwind v4 + shadcn, two apps (PC `/`, mobile `/m/`) |
| Tests | vitest + happy-dom + @testing-library |

## Directory (target shape)

```
apps/server/         single server process, composition root src/main.ts, vertical domain slices
apps/web/            PC app (dev port 8630)
apps/web-mobile/     mobile app (dev port 8631, base /m/)
packages/contract/   pure-logic shared package: requests and types shared by both apps
scripts/             dev.js dev orchestration
```

## Iron laws (the five easiest to break)

1. `data/` is production data. Nobody touches it by default; compare SHA-256 before and after any move.
2. Only `apps/server` writes databases. Web, AI, and scripts never connect directly.
3. Every write goes through the "proposal → confirm → transactional write" pipeline. Bypassing it is a defect.
4. Secrets, tokens, and private data never enter the repo.
5. Domains never import each other; dependency direction is always `apps → packages`.

Full rules in [AGENTS.md](../AGENTS.md), machine-enforced by ESLint.

## Ports

The 8629 block — 8629 spells TOBY on a T9 keypad:

| Port | Use |
| --- | --- |
| 8629 | Server (same port in dev and production) |
| 8630 | Dev web |
| 8631 | Dev web-mobile |

Docker binds `127.0.0.1:8629` only.

## Domains (target)

Nine domains:

`chat` `greeting` `ledger` `library` `memory` `notes` `proposals` `schedule` `todo`

Delivery principles:

- Framework first; features land as independent PRs.
- One domain per PR; lint / typecheck / test / docker all green before merge.

## Doc index

| Doc | Contents |
| --- | --- |
| [product-overview.md](product-overview.md) | Product: positioning, core interaction, dual-app split, nine domains, non-goals, success criteria |
| [system-overview.md](system-overview.md) | System architecture: module boundaries, runtime topology, proposal data flow, data boundaries, dependency direction |
| [decisions/](decisions/) | ADRs: vertical domains, dual web apps, shared contract package, server stack, web stack, AI integration design, doc maintenance |
| [features/](features/) | Per-domain target contracts: nine business domains plus auth (not yet implemented; land with each domain PR) |
| [PLAN.md](../PLAN.md) | Framework build plan (currently authoritative) |
| [AGENTS.md](../AGENTS.md) | AI collaboration rules and iron laws |

## Planned (per PLAN.md)

| Directory | Contents |
| --- | --- |
| `operations/` | Local dev and Docker deployment |

Maintenance rules: touch a `features/` doc only when a contract changes — pure implementation changes don't. Architecture changes come with a new ADR. Progress lives in commit history.
