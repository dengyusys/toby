# Toby

**Self-hosted personal assistant: AI proposes, you confirm, only then does the system write.**

English | [简体中文](README.zh.md)

Toby is a self-hosted, single-user personal assistant — a diligent study companion that keeps your schedule, notes, and project files in order. You talk to it in natural language; the AI turns your words into a constrained proposal; you review and confirm; only then does the server perform a deterministic write. Not a single byte lands in storage before your confirmation.

> **Status: framework phase.** The skeleton (monorepo, server, CI, Docker) comes first; features land as reviewed PRs. See [PLAN.md](PLAN.md).

## Quick start

Requirements: Node.js `22.23.2` and pnpm `11.18.0` (`corepack enable`). All commands run from the repo root.

```bash
pnpm install

pnpm run dev      # dev mode: PC http://127.0.0.1:8630/ , mobile http://127.0.0.1:8631/m/ , API proxied to server
pnpm run start    # production mode: build webs, single server process serves pages and API

# or deploy with Docker
docker compose up -d --build
```

- No AI key is needed during the framework phase; AI provider configuration arrives with the chat domain.
- The server binds to `127.0.0.1` by default — it is meant for your machine, not the public internet.

## Documentation

- [docs/README.md](docs/README.md) — documentation index (Chinese)
- [docs/product-overview.md](docs/product-overview.md) — positioning, scope, and roadmap (Chinese)
- [docs/system-overview.md](docs/system-overview.md) — architecture
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute ([中文](CONTRIBUTING.zh.md))
- [AGENTS.md](AGENTS.md) — rules for AI coding agents ([中文](AGENTS.zh.md))
- [PLAN.md](PLAN.md) — framework plan under review

## License

[MIT](LICENSE)
