# Docker Deployment Manual

English | [简体中文](docker.zh.md)

Three files drive the deployment — read what each does before running anything:

| File            | Role                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | Two stages: **build** (full toolchain: install dependencies, build both webs + server into `dist/`) then **runtime** (assembles the monorepo-relative layout: `pnpm-workspace.yaml`, `node_modules`, `apps/server/dist`, the two web `dist/` folders, `apps/server/package.json`) |
| `compose.yaml`  | Runs the runtime image: binds `127.0.0.1:8629`, mounts `./data` as the database volume, injects `.env`, defines the healthcheck                                                                                                                                                   |
| `.dockerignore` | Keeps secrets (`data/`, `.env`) and machine-local installs (`node_modules/`, `dist/`) out of the build context                                                                                                                                                                    |

The monorepo layout is preserved inside the image on purpose: the server
resolves the repository root by finding `pnpm-workspace.yaml` at startup,
and reads `apps/server/package.json` for its version.

## Step 0 — engine up

Start Docker Desktop, then verify:

```bash
docker info
```

## Step 1 — base image (China network)

`FROM node:22.23.2-bookworm-slim` — the exact `engines` version, since
`engine-strict=true` rejects any other 22.x. If Docker Hub is
unreachable (`failed to fetch oauth token`), pull through a mirror and
retag:

```bash
docker pull docker.m.daocloud.io/library/node:22.23.2-bookworm-slim
docker tag  docker.m.daocloud.io/library/node:22.23.2-bookworm-slim node:22.23.2-bookworm-slim
```

Mirrors change often — if this one fails, substitute another public
Docker Hub mirror. Once `node:22.23.2-bookworm-slim` exists locally,
`docker build` no longer needs Docker Hub.

## Step 2 — build the image

```bash
docker build -t toby .
```

What happens: the build stage deletes the `prepare` script (git hooks
need a `.git` directory that build contexts don't have), installs the
locked dependencies, and runs `pnpm run build` — both webs and the
server land in `dist/`. The runtime stage then copies only what the
server needs at runtime.

## Step 3 — run

```bash
docker compose up -d
```

- Port: `127.0.0.1:8629` only — loopback exposure, nothing public.
- Data: `./data` is mounted into the container; the database files stay
  on your host, so backing up `./data` there is all a backup needs.
- Config: `.env` is injected if present. Note: a `TOBY_DATA_ROOT` with a
  **Windows absolute path** must be removed for container use — inside
  the container the data root is `/app/data`.

## Step 4 — verify

```bash
docker compose ps                       # state: healthy
curl http://127.0.0.1:8629/api/system/health
```

Then open `http://127.0.0.1:8629/` — the PC app, served by the
container. Logs: `docker compose logs -f server`.

## Day-2 operations

- **Stop / start**: `docker compose stop` / `docker compose start`.
- **Deploy an update**: `git pull`, then `docker compose up -d --build`
  (rebuilds the image and replaces the container; `data/` survives).
- **Teardown**: `docker compose down` (keeps `data/` and the image).
- **Backup**: stop the container and copy `data/`. While it runs, copy
  through SQLite (`VACUUM INTO`) rather than `cp`: committed writes may
  still sit in the `-wal` sidecar.

## Troubleshooting

- **`failed to fetch oauth token`** — Docker Hub unreachable; see Step 1.
- **Healthcheck `unhealthy`** — `/api/system/health` is exempt from
  authentication by design (the Docker healthcheck depends on it), so this
  means the process or port is actually broken; check `docker logs`.
- **Port 8629 in use** — the dev server or another container holds it;
  free it or change the mapping and `TOBY_PORT` together.
- **`Cannot find module` at container start** — the runtime stage lost a
  piece of the monorepo layout; every path in the `Dockerfile` runtime
  section is load-bearing.
