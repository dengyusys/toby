# ECS Deployment (image direct transfer)

English | [简体中文](deploy-ecs.zh.md)

Deploy the `toby` image to a single Aliyun ECS (or any VPS) without a
container registry: build locally, transfer the image tarball with `scp`,
`docker load` on the server. ACR/CI automation can replace this later; see
"Future automation" below.

Files involved — all in `deploy/` in this repo:

| File                  | Role                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `compose.server.yaml` | Server-side compose: local image (no `build:`), loopback port, health probe `/` |
| `env.example`         | Environment template — copy to `.env`, fill password hash + provider keys       |
| `toby.tar.gz`         | The image tarball (gitignored, regenerated per release via `docker save`)       |

## 0 — Prerequisites

- An ECS you can SSH into (2 vCPU / 4 GB is plenty).
- Security group: **do not open 8629**. Nothing else needs opening for the
  default setup — first-time verification goes through an SSH tunnel.

## 1 — On the dev machine: build and export

```bash
docker build -t toby .
docker save toby | gzip > deploy/toby.tar.gz
sha256sum deploy/toby.tar.gz > deploy/toby.tar.gz.sha256
```

## 2 — On the dev machine: generate the password hash

```bash
node scripts/hash-password.js 'your-login-password'
# paste the whole scrypt$... output into the server's .env
```

Never send the password itself through any channel you do not control.

## 3 — Upload

```bash
ssh root@<IP> "mkdir -p /opt/toby-init /opt/toby/data"
scp deploy/toby.tar.gz deploy/compose.server.yaml deploy/env.example root@<IP>:/opt/toby-init/
```

Optionally verify the transfer: `sha256sum /opt/toby-init/toby.tar.gz` must
match `deploy/toby.tar.gz.sha256`.

Optional data migration from an existing local install: stop the local
container first (`docker compose stop`), then
`tar czf data.tar.gz -C data .` and upload it the same way. Compare
SHA-256 checksums before and after the move.

## 4 — On the server: install Docker, load, configure

```bash
ssh root@<IP>

# Docker (Alibaba Cloud Linux 3 uses dnf; Ubuntu uses apt)
dnf install -y docker docker-compose-plugin
# or: apt-get update && apt-get install -y docker.io docker-compose-plugin
systemctl enable --now docker

# Load the image (~1-2 min)
docker load < /opt/toby-init/toby.tar.gz     # -> Loaded image: toby:latest

# Lay out the runtime folder
cd /opt/toby
cp /opt/toby-init/compose.server.yaml docker-compose.yaml
cp /opt/toby-init/env.example .env
chmod 600 .env
vi .env        # TOBY_AUTH_PASSWORD_HASH + provider keys
```

## 5 — Run and verify

```bash
cd /opt/toby && docker compose up -d
docker compose ps                              # Up (healthy) after ~15s
curl -I http://127.0.0.1:8629/                 # expect 200
curl http://127.0.0.1:8629/api/system/health   # expect 401 — auth is on
docker logs toby 2>&1 | tail -5                # "toby server started"
```

First check from your own machine — no ports opened, SSH tunnel:

```bash
ssh -N -L 8629:127.0.0.1:8629 root@<IP>
# then open http://127.0.0.1:8629/ locally
```

For permanent access pick one: reverse proxy with TLS on a filed domain
(keep the loopback binding), or a WireGuard/Tailscale overlay (change the
port mapping to `"8629:8629"`, still no security-group rule for 8629).

## 6 — Day-2 on the server

```bash
docker logs -f toby
docker exec toby node apps/server/dist/infrastructure/db/backup-cli.js   # backup
docker compose stop / start / down
```

Pull backups off the server regularly — an ECS disk is not a backup.

## Updating to a new version

Dev machine: step 1, then upload `toby.tar.gz` again. Server:

```bash
docker load < /opt/toby-init/toby.tar.gz && cd /opt/toby && docker compose up -d
```

`data/` is untouched; user data survives updates.

## Future automation

When updates become routine, replace the tarball transfer with a registry +
CI pipeline (e.g. Aliyun ACR or GHCR): CI builds and pushes on merge, the
server updates with `docker compose pull && docker compose up -d`. Registry
credentials live in the CI secrets — contributors never handle them.
