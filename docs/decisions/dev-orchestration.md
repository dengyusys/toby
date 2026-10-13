# Why dev.js Spawns node Directly

English | [简体中文](dev-orchestration.zh.md)

## The core idea

The dev orchestrator (`scripts/dev.js`) starts every child process the same way: **`spawn(process.execPath, [<path to the tool's JS entry>])` — node.exe running a file inside `node_modules` directly.** It never spawns `pnpm` / `vite` by name and never sets `shell: true`.

## The two mainstream schools

Programmatic invocation of workspace tooling has two established approaches:

- **Via package manager / shell** — `spawn("pnpm", ["--filter", "@toby/web", "dev"])` or `spawn("vite", { shell: true })`. This is what `pnpm run` itself does (hand the line to a shell, let PATH find the `node_modules/.bin` shim) and what `concurrently` does by default. Convenient and portable — but on Windows the process chain becomes `orchestrator → cmd.exe → node → vite`, and `kill()` terminates the cmd.exe wrapper while the real server survives as an orphan holding its port. Mainstream tools in this school bolt on process-tree killers (`tree-kill`, Windows Job Objects) to patch exactly this.
- **Directly with node** — resolve the tool's bin entry (`vite`'s package.json `bin` field → `bin/vite.js`) and run it with node itself. This is `child_process.fork()`'s very mechanism, how nodemon starts scripts, and how jest/vitest spawn their workers.

We chose the second school. Deterministic teardown — one Ctrl+C kills everything, nothing left holding a strict port — is a core requirement of the orchestrator, and the first school cannot promise it on Windows without extra dependencies.

## Why touching the shims is wrong even when it works

The `.cmd` / `.ps1` / extensionless shims in `node_modules/.bin` are an interface **for shells** (PATH lookup), not for programs. On Unix the extensionless file self-identifies via its `#!/usr/bin/env node` shebang; Windows has no shebang mechanism, hence the `.cmd` wrapper. Node's fix for the BatBadBut vulnerability (CVE-2024-27980, Node 18.20 / 20.12+) made spawning `.cmd` / `.bat` without `shell: true` a hard error — the "just spawn the shim" path is not merely flaky, the platform rejects it.

## What this buys us

- One code path on Windows / macOS / Linux; identical behavior, no per-platform branches
- Signals and `kill()` reach the real process — no wrapper absorbing them
- Every child runs under the same node executable and version as the orchestrator (which `engines.node` pins anyway)
- Zero extra dependencies for process management

## Costs and mitigations

- The orchestrator must know tool entry paths (`apps/*/node_modules/vite/bin/vite.js`). They are pinned by vite's own `bin` field, and a pre-flight `existsSync` check fails fast with "run pnpm install first" instead of a cryptic ENOENT.
- Piped output disables auto-detected ANSI colors — restored explicitly with `FORCE_COLOR=1`.

## Rules in this repository

- `scripts/` spawns children only as `{ process.execPath, [JS file] }`; `shell: true` is forbidden there
- The root integration test (`test/http-contract.integration.test.ts`) follows the same pattern for the server process
- Introducing an orchestrator dependency (concurrently, tree-kill, …) would contradict this decision and requires revisiting this ADR
