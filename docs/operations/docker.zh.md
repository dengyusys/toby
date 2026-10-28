# Docker 部署手册

[English](docker.md) | 简体中文

三个文件支撑整套部署——动手前先弄清各自干什么:

| 文件            | 职责                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`    | 两个阶段:**build**(完整工具链:装依赖、构建两个前端与服务端到 `dist/`)与 **runtime**(拼装 monorepo 相对布局:`pnpm-workspace.yaml`、`node_modules`、`apps/server/dist`、两个前端的 `dist/`、`apps/server/package.json`) |
| `compose.yaml`  | 运行镜像:绑定 `127.0.0.1:8629`,把 `./data` 挂载为数据库卷,注入 `.env`,定义健康检查                                                                                                                                    |
| `.dockerignore` | 把密钥(`data/`、`.env`)与机器本地安装产物(`node_modules/`、`dist/`)挡在构建上下文之外                                                                                                                                 |

镜像内**有意保留 monorepo 相对布局**:服务端启动时靠寻找
`pnpm-workspace.yaml` 定位仓库根,并读取 `apps/server/package.json`
获取版本号。

## 第 0 步 —— 引擎就绪

启动 Docker Desktop,然后验证:

```bash
docker info
```

## 第 1 步 —— 基础镜像(国内网络)

`FROM node:22.23.2-bookworm-slim` —— 与 `engines` 精确一致的版本,
因为 `engine-strict=true` 会拒绝其他 22.x。若 Docker Hub 不可达
(`failed to fetch oauth token`),经镜像源拉取并重打标签:

```bash
docker pull docker.m.daocloud.io/library/node:22.23.2-bookworm-slim
docker tag  docker.m.daocloud.io/library/node:22.23.2-bookworm-slim node:22.23.2-bookworm-slim
```

镜像源经常变动——这个不行就换其他公共 Docker Hub 镜像源。本地一旦
存在 `node:22.23.2-bookworm-slim`,`docker build` 就不再需要
Docker Hub。

## 第 2 步 —— 构建 toby 镜像

```bash
docker build -t toby .
```

会发生什么:build 阶段先删掉 `prepare` 脚本(git 钩子需要构建上下文
里没有的 `.git` 目录),按 lockfile 安装依赖,再跑 `pnpm run build` ——
两个前端与服务端进入 `dist/`。runtime 阶段随后只拷贝运行所需内容。

## 第 3 步 —— 运行

```bash
docker compose up -d
```

- 端口:仅 `127.0.0.1:8629` —— 回环暴露,不对公网。
- 数据:`./data` 挂载进容器;数据库文件留在宿主机,因此在宿主机上
  备份 `./data` 就是一次完整备份。
- 配置:存在 `.env` 则注入。注意:`TOBY_DATA_ROOT` 若是 **Windows
  绝对路径**,容器使用前必须删除 —— 容器内的数据根是 `/app/data`。

## 第 4 步 —— 验证

```bash
docker compose ps                       # 状态: healthy
curl http://127.0.0.1:8629/api/system/health
```

然后打开 `http://127.0.0.1:8629/` —— 容器提供的 PC 端应用。日志:
`docker compose logs -f server`。

## 日常操作

- **停止 / 启动**:`docker compose stop` / `docker compose start`。
- **部署更新**:`git pull` 后 `docker compose up -d --build`(重建镜像
  并替换容器;`data/` 不受影响)。
- **拆除**:`docker compose down`(保留 `data/` 与镜像)。
- **备份**:停止容器后拷贝 `data/` 即可。容器运行中改用 SQLite 的
  `VACUUM INTO` 而不是 `cp`:已提交的写入可能还在 `-wal` 旁路文件里。

## 故障排查

- **`failed to fetch oauth token`** —— Docker Hub 不可达;见第 1 步。
- **healthcheck `unhealthy`** —— `/api/system/health` 按设计豁免认证
  (Docker healthcheck 就依赖它),报 unhealthy 说明进程或端口真的有问题;
  用 `docker logs` 查。
- **端口 8629 被占** —— dev server 或别的容器占着;释放它,或同时改
  端口映射与 `TOBY_PORT`。
- **容器启动报 `Cannot find module`** —— runtime 阶段丢了 monorepo
  布局的一块;`Dockerfile` runtime 段的每一条路径都是承重的。
