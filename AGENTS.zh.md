# Toby Agent 工作指南

[English](AGENTS.md) | 简体中文

给 AI 编码代理看的仓库工作指南。

> **当前状态:** 已上线域以 `apps/server/src/domains/` 目录为准;`docs/features/` 存放目标契约(不是落地标记),`docs/decisions/` 存放 ADR。`PLAN.md` 保留为框架期规划,其版本矩阵仍是 pnpm catalog(工作区集中版本清单)的唯一事实来源。

## 项目简介

自托管个人助手:用户说一句话,AI 拟一条受限提案,用户确认后服务端才写入。产品:[README.zh.md](README.zh.md) · 架构:[docs/system-overview.zh.md](docs/system-overview.zh.md) · 各域契约:[docs/features/](docs/features/)。

动手前:从 `docs/features/` 与 `docs/decisions/` 找「当前算数」的那份文档(功能文档 + ADR),别信记忆;先查有没有现成实现,别造平行方案。

## 命令

都在仓库根目录跑:

| 命令                               | 干什么                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `pnpm run dev`                     | 起开发环境:server 8629 → web 8630 / web-mobile 8631                 |
| `pnpm run start`                   | 生产模式:构建前端与服务端,运行 `dist/main.js`(单进程提供页面与 API) |
| `pnpm run check`                   | 全量检查:typecheck / lint / format / test                           |
| `pnpm run typecheck`               | 仅类型检查                                                          |
| `pnpm run lint`                    | 仅 ESLint(代码质量规则)                                             |
| `pnpm run format` / `format:check` | Prettier 格式化 / 校验                                              |
| `pnpm run test`                    | 全部测试(先构建服务端;各包 + 根 HTTP 集成与边界测试)                |
| `pnpm run build`                   | 构建两个 web 与服务端(`nest build` → `dist/`)                       |

端口、进程、部署细节看 `docs/operations/`,这里不重复。

## 测试约定

- 测试用临时数据目录与假的 AI / 日志实现,正式数据一个字节不碰。
- 自动化测试不调真实 AI、不远程部署、不写正式数据。真要跑这些,任务必须明确授权,结果与本地自动化分开报告。
- 改了什么,就跑什么:

| 改动                                                  | 必须执行                                             |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `apps/server/` 代码                                   | `pnpm run test`(域测试 + 根集成测试)                 |
| `apps/web/`、`apps/web-mobile/`、`packages/contract/` | `pnpm run test` + `pnpm run typecheck`               |
| TS/JS 源码或 ESLint/Prettier 配置                     | `pnpm run lint`、`pnpm run format:check`             |
| `package.json`、lockfile、workspace 配置              | `pnpm install --frozen-lockfile`、`pnpm run check`   |
| Markdown 或文档路径                                   | 查受影响文档的链接和旧路径引用,跑 `git diff --check` |

一次改到好几样,就把各行的检查都跑了。

## 目录结构

- `apps/server/`——服务端单进程;组合根 `src/main.ts`;垂直域切片在 `src/domains/<域>/`。每个域的对外错误码以闭联合集形式登记在 `src/domains/<域>/errors.ts`——新增错误码只加在那里和 web 客户端,别处不加。
- `apps/web/`(PC 端,`/`)与 `apps/web-mobile/`(移动端,`/m/`)——两个 React SPA,互不导入。
- `packages/contract/`(纯逻辑)——唯一的跨端共享通道;组件与样式各端自持,永不共享。
- 依赖方向永远 `apps → packages`:packages 不许 import apps;前端不许 import `@toby/server`。
- 域互不导入;跨域接线只在组合根。`infrastructure/` 不导入业务域;域内 `types.ts` 保持纯净(禁 fastify / infrastructure / `node:`)。
- 以上边界由 `test/boundaries.test.ts` 中的导入边界测试机器强制,违规即构建失败。
- `data/` 存运行时 SQLite 数据库。

## 代码风格

- `apps/web`、`apps/web-mobile`、`packages`:`.ts` 由 Node 22 直跑、无构建 —— 禁 `enum` / `namespace` / 类参数属性;类型导入用 `import type`(`erasableSyntaxOnly` 自动拦违规)。
- `apps/server`:经 `nest build` 构建;允许装饰器、`emitDecoratorMetadata`、类参数属性与 Nest 惯用法。server 测试走 vitest 的 swc 转换(`apps/server/vitest.config.ts`),与构建一样产出装饰器元数据——服务写成带构造注入的 `@Injectable()` 类;`@Inject(token)` 只用于值型或可选依赖(`TOBY_CONFIG` / `CLOCK`,域 extractor / timing token),日志用内置 `new Logger(X.name)` 门面(见 `docs/decisions/idiomatic-nest-services.zh.md`)。
- 禁 Python;引入前必须先有 ADR。

## Git 工作流

- **每一次提交和每一次推送都必须先经用户明确允许和确认——每次都要,无例外。**自动提交与自动推送一律禁止,即使用户要求了改动本身、或此前有过获批的提交。
- AI 不自行 commit、push 或改写历史:先给用户看确切改动和完整提交信息,得到明确批准再动手。批准计划不等于批准单笔提交。
- 动手前先跑 `git status --short`——工作区里别人的改动,不碰也不回退。
- 提交信息与代码注释用**英文**;Conventional Commits,scope 用英文域名(如 `feat(schedule): add month view`)。
- 提交信息只留一行标题:不写正文段落,不加 Co-Authored-By 之类尾注。
- 改动直接 push 进 `main`:推之前本地 `pnpm run check` 必须全绿。CI 在 push 到 `main` 与每次 PR 后跑同样四项检查,作为事后保险。Dependabot 暂时停用(已删除 `.github/dependabot.yml`),当前没有 PR。大型迁移可走 `feat/*` 分支、本地合并后再推。
- 文档是双语的:任何文档改动必须同时落到英文文件与它的 `.zh.md` 镜像,同一笔提交内完成。
- 契约变了才更新 `docs/features/` 对应文档,纯实现细节变化不用碰;架构变化伴随 `docs/decisions/` 新 ADR;进度以提交历史为准。

## 边界与安全

- `data/` 下所有库与文件都是正式数据。平时谁也不许改;只有用户明确点名的维护任务才能动。挪动或恢复前后,必须比对 **SHA-256**。
- 数据库只有服务端(`apps/server`)能写。Web、AI、脚本都不许直连数据库。
- 一切新增/修改/删除必须走「AI 提案 → 用户确认 → 服务端事务写入」管线;绕过它的写接口都算缺陷。AI 工具注册时必须携带安全分级(read-only 只读 / write-intent 写意图:只能产出提案)并由策略门控强制;禁区能力(数据库、Shell、文件路径)作为工具定义根本不存在。见 docs/decisions/ai-pi-runtime.zh.md。
- API key、Token、证书私钥、服务器凭据、个人敏感数据、完整生产日志:不进源码、文档、测试、快照、提交,哪儿都不进。
- 代码和文档打架、又牵扯数据/安全/对外接口?停下来问用户,别自己挑边。
