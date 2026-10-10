# Toby 文档

[English](README.md) | 简体中文

一句话:**自托管个人助手**——你在聊天框说一句话,AI 生成受限提案,你确认后,服务端才写数据。写路径的完整描述见[产品总览](product-overview.zh.md)。

## 现在到哪一步了

框架期。目前只有:

- 规范文档(AGENTS / PLAN / README / 产品总览)
- 目录占位:`apps/server`、`apps/web`、`apps/web-mobile`、`packages/contract`、`scripts`

还没有:代码、CI、Docker。下一步按 `PLAN.md` 的提交序列搭骨架。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行 | Node 22.23.2,`.ts` 直跑,无构建步骤 |
| 包管理 | pnpm 11.18.0 workspaces(`apps/*` + `packages/*`) |
| 服务端 | Fastify 5 + better-sqlite3 + pino + zod |
| 前端 | React 19 + Vite 6 + Tailwind v4 + shadcn,双应用(PC `/`、移动 `/m/`) |
| 测试 | vitest + happy-dom + @testing-library |

## 目录(目标形态)

```
apps/server/         服务端单进程,组合根 src/main.ts,垂直域切片
apps/web/            PC 端(开发端口 8630)
apps/web-mobile/     移动端(开发端口 8631,base /m/)
packages/contract/   纯逻辑共享包:双端共用的请求与类型
scripts/             dev.js 开发编排
```

## 铁律(最容易踩的五条)

1. `data/` 是生产数据,默认谁都不碰;挪动前后比对 SHA-256。
2. 只有 `apps/server` 能写数据库。Web、AI、脚本都不许直连。
3. 每次写数据都要走"提案 → 确认 → 事务写入"管线。绕过就是缺陷。
4. 密钥、令牌、隐私数据永不进仓库。
5. 域与域互不导入;依赖方向永远 `apps → packages`。

完整规则见 [AGENTS.zh.md](../AGENTS.zh.md),由 ESLint 机器强制。

## 端口

8629 块——8629 是 T9 键盘上的 TOBY:

| 端口 | 用途 |
| --- | --- |
| 8629 | 服务端(开发与生产同端口) |
| 8630 | 开发模式 web |
| 8631 | 开发模式 web-mobile |

Docker 只绑 `127.0.0.1:8629`。

## 功能域(目标)

九个功能域:

`chat` `greeting` `ledger` `library` `memory` `notes` `proposals` `schedule` `todo`

落地原则:

- 框架先行,功能以独立 PR 逐步落地。
- 一域一 PR,lint / typecheck / test / docker 四项检查全绿才合并。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [product-overview.zh.md](product-overview.zh.md) | 产品总览:定位、核心交互、双端分工、九域范围、非目标、成功标准 |
| [system-overview.zh.md](system-overview.zh.md) | 系统架构:模块边界、运行拓扑、提案数据流、数据边界、依赖方向 |
| [decisions/](decisions/) | ADR:垂直域切片、双端拆分、共享契约包、服务端技术栈、前端技术栈、AI 接入设计、文档维护约定 |
| [features/](features/) | 各域目标契约:九个业务域 + 认证(域未实施,随域 PR 落地) |
| [PLAN.md](../PLAN.md) | 框架搭建计划(当前权威) |
| [AGENTS.zh.md](../AGENTS.zh.md) | AI 协作规则与铁律 |

## 以后会有的(按 PLAN.md)

| 目录 | 内容 |
| --- | --- |
| `operations/` | 本地开发与 Docker 部署 |

维护规则:契约变了才改 `features/` 文档,纯实现改动不动文档;架构变更配一篇新 ADR;进度以提交历史为准。
