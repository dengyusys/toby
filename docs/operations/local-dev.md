# Local Development

English | [简体中文](local-dev.zh.md)

## Ports and processes

| Process                      | Port | Role                                                             |
| ---------------------------- | ---- | ---------------------------------------------------------------- |
| Toby server (`@toby/server`) | 8629 | API + production static serving (`/`, `/m/`)                     |
| Web dev server (Vite)        | 8630 | PC app at `http://localhost:8630/`, proxies `/api` to 8629       |
| Web-mobile dev server (Vite) | 8631 | Mobile app at `http://localhost:8631/m/`, proxies `/api` to 8629 |

All ports are fixed (`strictPort`): if one is occupied, that process fails fast instead of silently drifting to another port. 8629 is `TOBY` on a T9 keypad.

## `pnpm run dev`

Starts three processes from one command, orchestrated by `scripts/dev.js`:

1. **Server first** — the server starts on 8629 and must answer `/api/system/health` before anything else launches (20 s deadline).
2. **Then both Vite dev servers** — web on 8630, web-mobile on 8631. Both proxy `/api` to the server, which is why the health gate exists.
3. **Labeled output** — every log line is prefixed `[server]`, `[web]`, or `[web-mobile]` so interleaved logs stay attributable.
4. **One Ctrl+C stops everything** — any child exiting unexpectedly (for example the server on a port conflict) tears the whole set down; nothing is left holding a port.

Known limitation: the health gate reads `TOBY_PORT` from exported environment variables only. If you change `TOBY_PORT` inside `.env`, export it in your shell too (`export TOBY_PORT=8632` style), or the orchestrator will poll the wrong port.

## Environment variables

Loaded from the repository-root `.env` when present (copy `.env.example` to start). Relative `TOBY_DATA_ROOT` resolves against the repository root, not the current directory.

| Variable                        | Default       | Meaning                                                                                           |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `TOBY_HOST`                     | `127.0.0.1`   | Bind address; loopback or `0.0.0.0` (container) only                                              |
| `TOBY_PORT`                     | `8629`        | Server port (dev and production share it)                                                         |
| `TOBY_DATA_ROOT`                | `<repo>/data` | Domain database directory (SQLite dialect)                                                        |
| `TOBY_DB_DIALECT`               | `sqlite`      | Database dialect for all domain databases; `mysql` switches to per-domain schemas `toby_<domain>` |
| `TOBY_DB_MYSQL_HOST`            | `127.0.0.1`   | MySQL host (mysql dialect only)                                                                   |
| `TOBY_DB_MYSQL_PORT`            | `3306`        | MySQL port (mysql dialect only)                                                                   |
| `TOBY_DB_MYSQL_USER`            | `toby`        | MySQL user (mysql dialect only)                                                                   |
| `TOBY_DB_MYSQL_PASSWORD`        | _(empty)_     | MySQL password (mysql dialect only)                                                               |
| `TOBY_DB_MYSQL_DATABASE_PREFIX` | `toby_`       | MySQL schema name prefix (mysql dialect only)                                                     |
| `TOBY_LOG_LEVEL`                | `info`        | pino level (`warn` quiets dev output)                                                             |

The MySQL adapter is optional (see the [db adapter decision](../decisions/db-adapter.md)); SQLite is the recommended default and `pnpm run test` never needs a MySQL daemon — MySQL adapter tests run only when `TOBY_TEST_MYSQL_URL` is set.

## Windows notes

- `scripts/dev.js` spawns `node.exe` directly against each tool's JS entry (for example `apps/web/node_modules/vite/bin/vite.js`). This is deliberate: Windows `spawn` does not resolve the `.cmd` shims pnpm generates, and `shell: true` would interpose a wrapper that breaks signal forwarding.
- Ctrl+C in a Windows console reaches the orchestrator and all three children; the orchestrator still kills them explicitly as a safety net.

## Troubleshooting

| Symptom                                          | Cause and fix                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `[dev] ...vite/bin/vite.js not found`            | Dependencies not installed — run `pnpm install` first                                                            |
| `[server] exited unexpectedly` right after start | 8629 already in use (EADDRINUSE) — free the port or set `TOBY_PORT` (and export it)                              |
| Vite reports port 8630/8631 in use               | A previous run left a process behind — kill it; the orchestrator is designed to prevent this                     |
| `/` and `/m/` 404 from port 8629                 | No web build yet (`apps/*/dist` absent) — expected on a fresh clone; run `pnpm run build` or use the dev servers |
