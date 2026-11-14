# Local Development

English | [简体中文](local-dev.zh.md)

## Ports and processes

| Process                      | Port | Role                                                             |
| ---------------------------- | ---- | ---------------------------------------------------------------- |
| Toby server (`@toby/server`) | 8629 | API + production static serving (`/`, `/m/` → Vite in dev)       |
| Web dev server (Vite)        | 8630 | PC app at `http://localhost:8630/`, proxies `/api` to 8629       |
| Web-mobile dev server (Vite) | 8631 | Mobile app at `http://localhost:8631/m/`, proxies `/api` to 8629 |

All ports are fixed (`strictPort`): if one is occupied, that process fails fast instead of silently drifting to another port. 8629 is `TOBY` on a T9 keypad.

## `pnpm run dev`

The server runs via `scripts/server-dev.js`: Node 22's native type stripping runs `src/main.ts` directly under `node --watch` — there is no compile step in dev, and every change in the import graph just restarts the process (the server source is erasable-syntax-only, so no transform is needed). Type errors never gate a restart: the editor and `pnpm run check` own them, and production still builds through plain `tsc` (`pnpm run build`). The web apps on 8630/8631 keep Vite HMR — component edits hot-swap with no page reload.

The server never serves the web builds in dev: `/`, `/m` and `/m/` on 8629 answer 302 to the Vite servers, so a stale `apps/*/dist` from an earlier `pnpm run build` cannot pose as the app. The targets come from `TOBY_DEV_PC_ORIGIN` / `TOBY_DEV_MOBILE_ORIGIN`: `scripts/server-dev.js` sets the defaults, and values exported in your shell override them (only exported ones — the same limitation as `TOBY_PORT` below).

Starts three processes from one command, orchestrated by `scripts/dev.js`:

1. **Server first** — the server starts on 8629 and must answer `/api/system/health` before anything else launches (20 s deadline).
2. **Then both Vite dev servers** — web on 8630, web-mobile on 8631. Both proxy `/api` to the server, which is why the health gate exists.
3. **Labeled output** — every log line is prefixed `[server]`, `[web]`, or `[web-mobile]` so interleaved logs stay attributable.
4. **One Ctrl+C stops everything** — any child exiting unexpectedly (for example the server on a port conflict) tears the whole set down; nothing is left holding a port.

Known limitation: the health gate reads `TOBY_PORT` from exported environment variables only. If you change `TOBY_PORT` inside `.env`, export it in your shell too (`export TOBY_PORT=8632` style), or the orchestrator will poll the wrong port.

## Environment variables

Loaded from the repository-root `.env` when present (copy `.env.example` to start). Relative `TOBY_DATA_ROOT` resolves against the repository root, not the current directory.

| Variable                        | Default       | Meaning                                                                                                                                                                      |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOBY_HOST`                     | `127.0.0.1`   | Bind address; loopback or `0.0.0.0` (container) only                                                                                                                         |
| `TOBY_PORT`                     | `8629`        | Server port (dev and production share it)                                                                                                                                    |
| `TOBY_DATA_ROOT`                | `<repo>/data` | Domain database directory (SQLite dialect)                                                                                                                                   |
| `TOBY_DB_DIALECT`               | `sqlite`      | Database dialect for all domain databases; `mysql` switches to per-domain schemas `toby_<domain>`                                                                            |
| `TOBY_DB_MYSQL_HOST`            | `127.0.0.1`   | MySQL host (mysql dialect only)                                                                                                                                              |
| `TOBY_DB_MYSQL_PORT`            | `3306`        | MySQL port (mysql dialect only)                                                                                                                                              |
| `TOBY_DB_MYSQL_USER`            | `toby`        | MySQL user (mysql dialect only)                                                                                                                                              |
| `TOBY_DB_MYSQL_PASSWORD`        | _(empty)_     | MySQL password (mysql dialect only)                                                                                                                                          |
| `TOBY_DB_MYSQL_DATABASE_PREFIX` | `toby_`       | MySQL schema name prefix (mysql dialect only)                                                                                                                                |
| `TOBY_AI_MODEL`                 | _(empty)_     | pi-ai `provider/model` pair (e.g. `deepseek/deepseek-flash`); empty keeps the one-sentence AI path at 501; also runtime-configurable in the settings page (DB wins over env) |
| `DEEPSEEK_API_KEY`              | _(empty)_     | Provider credential read by pi-ai (per provider, never a TOBY_ variable); can also be stored via the settings page (stored credential wins)                                  |
| `TOBY_AI_TIMEOUT_MS`            | `30000`       | AI request timeout (1000–120000 ms)                                                                                                                                          |
| `TOBY_DEV_PC_ORIGIN`            | _(empty)_     | Dev only: target of the `/` redirect; `pnpm run dev` sets `http://localhost:8630`. Pairs with `TOBY_DEV_MOBILE_ORIGIN`                                                       |
| `TOBY_DEV_MOBILE_ORIGIN`        | _(empty)_     | Dev only: target of the `/m/` redirect; `pnpm run dev` sets `http://localhost:8631/m`. Pairs with `TOBY_DEV_PC_ORIGIN`                                                       |
| `TOBY_AUTH_PASSWORD_HASH`       | _(empty)_     | scrypt hash from `scripts/hash-password.js` (generate: `node scripts/hash-password.js "your password"`); setting it enables login                                            |
| `TOBY_AUTH_SESSION_TTL_HOURS`   | `168`         | Session lifetime (1–8760 hours)                                                                                                                                              |
| `TOBY_AUTH_SECURE_COOKIE`       | `false`       | `true` appends `Secure` to the session cookie (HTTPS deployments)                                                                                                            |

The MySQL adapter is optional (see the [db adapter decision](../decisions/db-adapter.md)); SQLite is the recommended default and `pnpm run test` never needs a MySQL daemon — MySQL adapter tests run only when `TOBY_TEST_MYSQL_URL` is set. Provider credentials stay out of the repository. Relative dates in one-sentence bookkeeping ("昨天" and the like) resolve against the server's own local time — run the server in the user's timezone.

## Windows notes

- `scripts/dev.js` spawns `node.exe` directly against each tool's JS entry (for example `apps/web/node_modules/vite/bin/vite.js`). This is deliberate: Windows `spawn` does not resolve the `.cmd` shims pnpm generates, and `shell: true` would interpose a wrapper that breaks signal forwarding.
- Ctrl+C in a Windows console reaches the orchestrator and all three children; the orchestrator still kills them explicitly as a safety net.

## Troubleshooting

| Symptom                                          | Cause and fix                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `[dev] ...vite/bin/vite.js not found`            | Dependencies not installed — run `pnpm install` first                                                            |
| `[server] exited unexpectedly` right after start | 8629 already in use (EADDRINUSE) — free the port or set `TOBY_PORT` (and export it)                              |
| Vite reports port 8630/8631 in use               | A previous run left a process behind — kill it; the orchestrator is designed to prevent this                     |
| `/` and `/m/` 404 from 8629 (production run)     | No web build yet (`apps/*/dist` absent) — expected on a fresh clone; run `pnpm run build` or use the dev servers |
