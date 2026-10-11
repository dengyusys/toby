# Contributing to Toby

English | [简体中文](CONTRIBUTING.zh.md)

Thanks for contributing to Toby. This project runs a disciplined PR workflow — please take two minutes to read this before you start.

## Development environment

- Node.js `22.23.2` (pinned in `.nvmrc`)
- pnpm `11.18.0` (enabled automatically via `corepack`)
- All commands run from the repo root

## Getting started

```bash
pnpm install
pnpm run dev      # dev environment: server 8629 + web 8630 + web-mobile 8631
```

## Pre-commit checks

| Command              | What it does                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm run check`     | Full check: typecheck / lint / format / test — this one command is enough before committing |
| `pnpm run typecheck` | Type checks only                                                                            |
| `pnpm run lint`      | ESLint only (including boundary rules)                                                      |
| `pnpm run test`      | Tests only (per-package + root HTTP integration tests)                                      |

The "what you changed is what you run" table lives in [AGENTS.md](AGENTS.md).

## Commit conventions

- **English Conventional Commits**, scopes in English:

```text
feat(schedule): add month view
fix(web-mobile): fix drawer swipe on iOS
docs(architecture): add system overview
chore(deps): bump dependencies
```

- Common types: `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `ci` / `build`
- Common scopes: `server` / `web` / `web-mobile` / `contract` / `ui` / `repo` / `tooling` / `deps`
- Commits are a single subject line: no body paragraphs, no trailers such as Co-Authored-By.
- A commit-msg hook validates the format; non-conforming commits are rejected.

## Branches and PRs

- `main` is protected: all changes go through a PR; all four CI checks (lint / typecheck / test / docker) must pass; **squash merge**. The PR title becomes the final commit message and follows the conventions above.
- Branch naming: `feat/<scope>-<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` — e.g. `feat/framework-server`.
- Fill in the PR template: change summary, contract impact (which `docs/features/*.md` changed), verification checklist.
- Open an issue first (bug / feature templates) and link it from the PR.

## Further rules

- Code boundaries, data discipline, test discipline: [AGENTS.md](AGENTS.md) ([中文](AGENTS.zh.md))
- Architecture: [docs/system-overview.md](docs/system-overview.md); per-domain contracts: [docs/features/](docs/features/)
