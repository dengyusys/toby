# 本地开发

[English](local-dev.md) | 简体中文

## 端口与进程

| 进程                        | 端口 | 角色                                                 |
| --------------------------- | ---- | ---------------------------------------------------- |
| Toby 服务端(`@toby/server`) | 8629 | API + 生产静态服务(`/`、`/m/`)                       |
| Web 开发服务器(Vite)        | 8630 | PC 端 `http://localhost:8630/`,`/api` 代理到 8629    |
| Web-mobile 开发服务器(Vite) | 8631 | 移动端 `http://localhost:8631/m/`,`/api` 代理到 8629 |

所有端口固定(`strictPort`):被占用时对应进程立即失败,绝不悄悄漂移到别的端口。8629 = T9 键盘上的 TOBY。

## `pnpm run dev`

服务端经 `nest start --watch`(由 `scripts/nest-dev.js` 拉起)运行:编译到 `dist/` 并在改动后自动重启。

一条命令拉起三个进程,由 `scripts/dev.js` 编排:

1. **服务端先行** —— 先在 8629 启动服务端,必须应答 `/api/system/health` 后才继续(20 秒截止)。
2. **随后两个 Vite 开发服务器** —— web 在 8630、web-mobile 在 8631。两者都把 `/api` 代理到服务端,这正是健康门控存在的原因。
3. **带前缀输出** —— 每行日志带 `[server]` / `[web]` / `[web-mobile]` 前缀,混排日志依然可归属。
4. **一次 Ctrl+C 全体退出** —— 任一子进程意外退出(例如服务端端口冲突)会把整套拉倒,不留任何进程占端口。

已知限制:健康门控只读取已导出环境变量里的 `TOBY_PORT`。若只改 `.env` 里的 `TOBY_PORT`,还需在 shell 中导出(`export TOBY_PORT=8632` 这种形式),否则编排器会探测错误的端口。

## 环境变量

存在时从仓库根 `.env` 加载(可从 `.env.example` 复制起步)。相对的 `TOBY_DATA_ROOT` 相对仓库根解析,不相对当前目录。

| 变量                             | 默认值        | 含义                                                                                      |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `TOBY_HOST`                      | `127.0.0.1`   | 绑定地址;仅允许回环地址或 `0.0.0.0`(容器)                                                 |
| `TOBY_PORT`                      | `8629`        | 服务端端口(开发与生产同端口)                                                              |
| `TOBY_DATA_ROOT`                 | `<仓库>/data` | 域数据库目录(SQLite 方言)                                                                 |
| `TOBY_DB_DIALECT`                | `sqlite`      | 所有域数据库的方言;设 `mysql` 切换为按域 schema `toby_<域>`                               |
| `TOBY_DB_MYSQL_HOST`             | `127.0.0.1`   | MySQL 主机(仅 mysql 方言)                                                                 |
| `TOBY_DB_MYSQL_PORT`             | `3306`        | MySQL 端口(仅 mysql 方言)                                                                 |
| `TOBY_DB_MYSQL_USER`             | `toby`        | MySQL 用户(仅 mysql 方言)                                                                 |
| `TOBY_DB_MYSQL_PASSWORD`         | _(空)_        | MySQL 密码(仅 mysql 方言)                                                                 |
| `TOBY_DB_MYSQL_DATABASE_PREFIX`  | `toby_`       | MySQL schema 名前缀(仅 mysql 方言)                                                        |
| `TOBY_AI_MODEL`                  | _(空)_        | pi-ai 的 `provider/model` 组合(如 `deepseek/deepseek-flash`);留空则一句话 AI 路径返回 501 |
| `DEEPSEEK_API_KEY`               | _(空)_        | pi-ai 读取的供应商密钥(各供应商各自的变量,不用 TOBY_ 前缀)                                |
| `TOBY_AI_TIMEOUT_MS`             | `30000`       | AI 请求超时(1000–120000 毫秒)                                                             |
| `TOBY_AUTH_PASSWORD_HASH`        | _(空)_        | `scripts/hash-password.js` 生成的 scrypt 哈希;设置即启用登录                              |
| `TOBY_AUTH_SESSION_TTL_HOURS`    | `168`         | 会话有效期(1–8760 小时)                                                                   |
| `TOBY_AUTH_RATE_LIMIT_MAX`       | `5`           | 每 IP 每窗口的登录尝试次数                                                                |
| `TOBY_AUTH_RATE_LIMIT_WINDOW_MS` | `60000`       | 登录限流窗口(1000–3600000 毫秒)                                                           |
| `TOBY_AUTH_SECURE_COOKIE`        | `false`       | `true` 为会话 Cookie 追加 `Secure`(HTTPS 部署)                                            |
| `TOBY_TRUST_PROXY`               | `false`       | 信任受控反向代理的 X-Forwarded-For(登录限流按真实客户端分桶)                              |
| `TOBY_LOG_LEVEL`                 | `info`        | pino 级别(`warn` 可让开发输出安静)                                                        |

MySQL 适配器是可选项(见[数据库适配器决策](../decisions/db-adapter.zh.md));推荐默认仍是 SQLite,`pnpm run test` 永远不需要运行中的 MySQL —— MySQL 适配器测试仅在设置了 `TOBY_TEST_MYSQL_URL` 时运行。供应商密钥不进仓库。一句话记账里的相对日期（「昨天」等）按服务器本地时间换算——请让服务器运行在与用户一致的时区。

## Windows 注意事项

- `scripts/dev.js` 直接用 `node.exe` 启动各工具的 JS 入口(例如 `apps/web/node_modules/vite/bin/vite.js`)。这是刻意的:Windows 的 `spawn` 不解析 pnpm 生成的 `.cmd` 垫片,而 `shell: true` 会垫一层破坏信号转发的包装进程。
- Windows 控制台的 Ctrl+C 会同时到达编排器与三个子进程;编排器仍会显式 kill 一遍作为兜底。

## 故障排查

| 现象                                      | 原因与处置                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `[dev] ...vite/bin/vite.js not found`     | 依赖未安装 —— 先 `pnpm install`                                                                |
| 启动后立刻 `[server] exited unexpectedly` | 8629 已被占用(EADDRINUSE)—— 释放端口或改 `TOBY_PORT`(并导出)                                   |
| Vite 提示 8630/8631 被占用                | 上次运行残留进程 —— 杀掉;编排器本身就是为了避免这种情况                                        |
| 8629 端口上 `/` 与 `/m/` 404              | 尚无前端构建(`apps/*/dist` 不存在)—— fresh clone 预期行为;跑 `pnpm run build` 或改用开发服务器 |
