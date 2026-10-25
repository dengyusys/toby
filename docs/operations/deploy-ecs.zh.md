# ECS 部署(镜像直传)

[English](deploy-ecs.md) | 简体中文

不经过镜像仓库,把 `toby` 镜像部署到单台阿里云 ECS(或任意 VPS):本机构建、
`scp` 直传镜像包、服务器 `docker load`。以后可以换成 ACR/CI 自动化,
见文末"后续自动化"。

涉及的文件都在仓库的 `deploy/` 目录:

| 文件                  | 作用                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `compose.server.yaml` | 服务器端 compose:本地镜像(无 `build:`)、回环端口、健康检查探 `/` |
| `env.example`         | 环境变量模板 —— 复制为 `.env`,填密码哈希与 AI 密钥               |
| `toby.tar.gz`         | 镜像包(gitignore 已忽略,每次发布用 `docker save` 重新生成)       |

## 0 — 前置条件

- 一台能 SSH 的 ECS(2 核 4G 足够)。
- 安全组:**不要放行 8629**。默认方案不需要开任何额外端口 ——
  首次验证走 SSH 隧道。

## 1 — 本机:构建并导出

```bash
docker build -t toby .
docker save toby | gzip > deploy/toby.tar.gz
sha256sum deploy/toby.tar.gz > deploy/toby.tar.gz.sha256
```

## 2 — 本机:生成密码哈希

```bash
node scripts/hash-password.js '你的登录密码'
# 输出的 scrypt$... 整串粘到服务器的 .env 里
```

密码本身永远不要通过任何不受你控制的渠道发送。

## 3 — 上传

```bash
ssh root@<IP> "mkdir -p /opt/toby-init /opt/toby/data"
scp deploy/toby.tar.gz deploy/compose.server.yaml deploy/env.example root@<IP>:/opt/toby-init/
```

可选:校验传输无损 —— 服务器上 `sha256sum /opt/toby-init/toby.tar.gz`
应与 `deploy/toby.tar.gz.sha256` 一致。

可选的数据迁移(本机已有数据时):先停本机容器(`docker compose stop`),
再 `tar czf data.tar.gz -C data .` 同样上传。迁移前后各算一次
SHA-256 校验和并比对。

## 4 — 服务器:装 Docker、导入、配置

```bash
ssh root@<IP>

# 安装 Docker(Alibaba Cloud Linux 3 用 dnf;Ubuntu 用 apt)
dnf install -y docker docker-compose-plugin
# 或:apt-get update && apt-get install -y docker.io docker-compose-plugin
systemctl enable --now docker

# 导入镜像(约 1-2 分钟)
docker load < /opt/toby-init/toby.tar.gz     # -> Loaded image: toby:latest

# 摆放运行目录
cd /opt/toby
cp /opt/toby-init/compose.server.yaml docker-compose.yaml
cp /opt/toby-init/env.example .env
chmod 600 .env
vi .env        # 填 TOBY_AUTH_PASSWORD_HASH 和 AI 密钥
```

## 5 — 启动与验证

```bash
cd /opt/toby && docker compose up -d
docker compose ps                              # 约 15 秒后应为 Up (healthy)
curl -I http://127.0.0.1:8629/                 # 期望 200
curl http://127.0.0.1:8629/api/system/health   # 期望 401 —— 证明认证已生效
docker logs toby 2>&1 | tail -5                # 看到 "toby server started"
```

首次从你自己的电脑验证 —— 不开任何端口,走 SSH 隧道:

```bash
ssh -N -L 8629:127.0.0.1:8629 root@<IP>
# 然后本机浏览器打开 http://127.0.0.1:8629/
```

长期访问二选一:已备案域名 + 反向代理 TLS(保持回环绑定不变),
或 WireGuard/Tailscale 组网(端口映射改为 `"8629:8629`,
安全组依然不放行 8629)。

## 6 — 服务器日常运维

```bash
docker logs -f toby
docker exec toby node apps/server/dist/infrastructure/db/backup-cli.js   # 备份
docker compose stop / start / down
```

定期把备份拉回本地 —— ECS 磁盘不是备份。

## 更新版本

本机:执行第 1 步,重新上传 `toby.tar.gz`。服务器:

```bash
docker load < /opt/toby-init/toby.tar.gz && cd /opt/toby && docker compose up -d
```

`data/` 不受影响,用户数据在更新后保留。

## 后续自动化

更新频繁之后,把镜像直传升级为"镜像仓库 + CI"(如阿里云 ACR 或 GHCR):
合并代码后 CI 自动构建推送,服务器 `docker compose pull && docker compose up -d`
即可更新。仓库凭据放在 CI 的 secrets 里 —— 贡献者永远不经手。
