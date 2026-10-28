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
docker compose stop / start / down
```

Back up `data/` off the server regularly — an ECS disk is not a backup. Copy
it with the container stopped, or through SQLite (`VACUUM INTO`) while it
runs, never with a plain `cp`.

## Updating to a new version

Dev machine: step 1, then upload `toby.tar.gz` again. Server:

```bash
docker load < /opt/toby-init/toby.tar.gz && cd /opt/toby && docker compose up -d
```

`data/` is untouched; user data survives updates.

## Automated deployment (GitHub Actions → ACR → ECS)

Replaces the manual tarball update. On every push to `main` (after the four
checks pass) CI builds the image, pushes it to Aliyun ACR, then SSHes into
the server to pull and restart. Pipeline: `.github/workflows/ci.yml` (jobs
`docker` + `deploy`), gated by the repo variable `DEPLOY_ENABLED=true`.

One-time setup:

1. **ACR** (Aliyun console): enable the personal Container Registry, create a
   namespace (e.g. `toby`), note the fixed password from 访问凭证.
2. **Edit the workflow env** — `.github/workflows/ci.yml`, job `docker`:
   set `ACR_REGISTRY` (your region) and `ACR_NAMESPACE`.
3. **Deploy SSH key** (dev machine): `ssh-keygen -t ed25519 -f toby-deploy -N ""`,
   append `toby-deploy.pub` to the server's `~/.ssh/authorized_keys`.
4. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   `ACR_USERNAME`, `ACR_PASSWORD`, `ECS_HOST` (server IP),
   `ECS_SSH_KEY` (contents of the private `toby-deploy` key).
5. **Server** (once):
   ```bash
   docker login registry.cn-hangzhou.aliyuncs.com   # same ACR credentials
   # update the compose file and point it at the registry image:
   # scp deploy/compose.server.yaml root@<IP>:/opt/toby/docker-compose.yaml
   echo 'TOBY_IMAGE=registry.cn-hangzhou.aliyuncs.com/toby/toby:latest' >> /opt/toby/.env
   ```
6. **Enable**: repo → Settings → Secrets and variables → Actions → Variables →
   `DEPLOY_ENABLED` = `true`. Push to `main` (or run the workflow manually)
   and watch the Actions tab.

Rollback: the pipeline tags every build `sha-<commit>`; pin `TOBY_IMAGE` in
the server `.env` to the previous sha tag and `docker compose up -d`, or
flip `DEPLOY_ENABLED` to `false` to stop the pipeline while you recover.
