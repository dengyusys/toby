# 系统架构

[English](system-overview.md) | 简体中文

## 目标

本文描述仓库采用的**模块边界**、运行进程、数据流和依赖方向,粒度为域级与进程级。

三份文档各管一层:产品范围以[产品总览](product-overview.zh.md)为准;功能契约与验收以 `docs/features/` 各域文档为准;实现细节以代码与测试为准。

## 技术栈

| 层     | 选型                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行   | Node 22.23.2;服务端经 `nest build` 构建,前端经 Vite 构建                                                                                                                                  |
| 包管理 | pnpm 11.18.0 workspaces(`apps/*` + `packages/*`)                                                                                                                                          |
| 服务端 | NestJS 12（跑于 Fastify 5 之上）+ 自建数据库适配 port —— 指 ports-and-adapters 架构概念,非网络端口 —— （默认 SQLite，可选 MySQL）+ Nest 内置 logger + typebox（AI:pi-ai + pi-agent-core） |
| 前端   | React 19 + Vite 6 + Tailwind v4 + shadcn,双应用(PC `/`、移动端 `/m/`)                                                                                                                     |
| 测试   | vitest + happy-dom + @testing-library                                                                                                                                                     |

## 系统上下文

```mermaid
flowchart LR
    U(("用户")) --> W["Web 双应用(React SPA:<br/>PC 端 / 与移动端 /m/)"]
    W -->|"只读 API / 提案(HTTP)"| S["Toby server 单进程(NestJS / Fastify)<br/>垂直域 · 提案生命周期(actions 内核)"]
    S --> DB[("数据库，经适配 port 访问<br/>SQLite（默认）·MySQL（可选）<br/>只有 server 写")]
    S -->|"按安全分级门控的工具调用;写入只经提案"| AI(("AI 经 pi-ai / pi-agent-core 接入"))
```

- Web 只能通过 server API 访问数据,不能读取文件系统。
- server 是唯一日常读写入口:查询走只读 API;新增、修改和删除必须经**提案确认** —— 由 `infrastructure/actions/` 中的共享**提案确认内核**(actions kernel,一条状态机:创建/确认/过期)执行;记账域已在使用;语义详见 [actions-kernel.zh.md](decisions/actions-kernel.zh.md)。
- AI 工具携带安全分级(read-only / write-intent)并在策略门控下运行;真实效果仍需提案确认(docs/decisions/ai-pi-runtime.zh.md)。
- 根 `scripts/` 只做开发与多进程启动编排,不接触数据。
- 九个业务域中,提案确认已下沉为共享内核(见上)而非域;其余(对话 chat、问候 greeting、日程 schedule、手账 notes、待办 todo、记忆 memory、书库 library)逐个独立落地,每个域落地时在 `docs/features/` 立契约文档。

## 仓库结构

```text
apps/
├─ server/        # @toby/server:NestJS 单进程——页面、API、提案与安全写入
├─ web/           # @toby/web:PC 端(入口 /)
├─ web-mobile/    # @toby/web-mobile:移动端(入口 /m/)
packages/
├─ contract/      # @toby/contract:双端共享契约包(纯 TS,零 JSX/CSS/DOM)
scripts/          # 开发与多进程启动编排(dev.js)
data/             # 运行数据（域数据库与文件），Git 忽略，只有 server 写
docs/             # 产品、架构、ADR、功能契约与运维文档
test/             # 根 HTTP 集成测试
```

- `apps/` 存放可独立运行的应用;两个 Web 应用互不导入,跨端共享只经 `@toby/contract`(纯逻辑)。
- 依赖方向永远 `apps → packages`:packages 不导入 apps;Web 应用不导入 `@toby/server`。
- 以上边界由 `test/boundaries.test.ts` 中的导入边界测试机器强制,违规即构建失败。

## 运行拓扑

### 开发模式

`pnpm run dev` 由 `scripts/dev.js` 编排:server 先起,就绪后拉起两个 Vite。Vite 只承载开发期页面、热更新与 `/api` 代理;生产形态没有 Vite 进程。开发端口(server 8629、前端 8630/8631)见 [docs/operations/local-dev.zh.md](operations/local-dev.zh.md);8629 在 T9 键盘上正好拼出 TOBY。

### 生产或本地预览

- `pnpm run start`:先构建两个 Web 应用,再由 server 单进程在 `8629` 同时提供页面(`/` 与 `/m/`)与 API。
- server 默认只监听回环地址;Docker 部署只绑 `127.0.0.1:8629`,数据经卷挂载 `./data`。

## API 与提案数据流(目标形态)

一次写入的完整路径(端点契约随各域 `features/` 文档定稿):

```mermaid
sequenceDiagram
    autonumber
    participant W as Web(对话页)
    participant S as Toby server
    participant A as AI provider
    participant D as 数据库（适配 port）

    W->>S: 一句话(text、时间、时区)
    S->>A: 解析请求(只含指令文字)
    A-->>S: schema 校验过的条目草稿(submit_entries)
    S->>S: schema、领域与语义校验
    S->>D: 读取当前字段
    S-->>W: 短期提案(proposal_id、前值、后值)

    alt 用户确认(只提交 proposal_id)
        W->>S: commit(空请求体)
        S->>D: 事务内重读目标字段并检查冲突
        alt 无冲突
            S->>D: 串行执行写入并提交
            S-->>W: 事务内结果快照
        else 字段冲突
            S-->>W: 拒绝整条提案,零写入
        end
    else 取消 / 过期 / 离开页面
        W->>S: cancel(空请求体)
        S-->>W: 提案作废,零写入
    end
```

两个无法靠推理得知的细节:AI 的草稿必须先过形状、领域与语义校验才可能成为提案——`validation.ts` 是信任边界;客户端请求除 `proposal_id` 外不携带任何状态(commit/cancel 请求体为空)。

## 数据边界

- `data/` 是生产数据:默认谁都不碰;维护任务需用户点名,挪动或恢复前后比对 SHA-256。
- 日常读取只经 server API;日常写入只经提案确认。客户端、AI 和脚本不能直连数据库。
- 显式 `false` 和数值 `0` 是有效数据,不能按缺失值处理。
- server 做字段级修改:`NULL` 表示缺失,读取时省略;无关字段保持不变。
- 多字段提交是一条数据库事务;失败或中断由数据库回滚,不提供用户历史或撤销。
- 每个域拥有自己的数据库 —— SQLite 方言为文件 `data/<域>.db`,MySQL 方言为 schema `toby_<域>`(见[数据库适配器决策](decisions/db-adapter.zh.md));跨域永不共享数据库。

## 安全与依赖方向

```mermaid
flowchart TB
    BOOT["main.ts(组合根)<br/>每域一行装配,跨域接线只在这里"]
    INFRA["infrastructure/<br/>config(TOBY_*)·http(Nest 应用工厂/错误包络(统一错误响应结构)/双 SPA 静态)<br/>logging(Nest 内置 logger · Fastify 访问日志)·db(适配 port:sqlite / mysql)"]
    DOM["domains/*<br/>业务域,逐个落地"]
    BOOT --> INFRA
    BOOT --> DOM
```

域组织纪律:

- `domains/` 下每个域自含 Nest 模块工厂、controller、service、store 与纯业务文件;**域与域互不导入**,跨域接线只发生在组合根 `apps/server/src/main.ts`。
- 域内 `types.ts` 保持纯净:不导入 fastify、infrastructure、`node:` 模块。
- `infrastructure/` 不导入业务域;开库能力由 `infrastructure/db` 提供,域内 store 消费。
- 新增业务域无需登记规则——`test/boundaries.test.ts` 的边界测试从文件系统自动发现各域。

安全边界:

- HTTP 写路径必须经提案确认;任何绕过提案的写端点都是缺陷。记账域已在使用;后续域复用同一提案确认内核(infrastructure/actions/)。
- AI 不获得文件路径、数据内容与 shell;其工具经安全分级门控,write-intent(写意图)工具只产出提案(docs/decisions/ai-pi-runtime.zh.md)。密钥只存在于本地环境配置,Web 包内不得包含密钥。
- 引入 Python 等新运行时需先立 ADR。
- 上述导入纪律由 `test/boundaries.test.ts` 机器强制。

## 目录演进约定

- 单个域超过 15 个文件时,重新评估域内分层或拆子域;域内单文件超过 400 行时,按关注点拆分。
- 配置由 `infrastructure/config` 的 `resolveConfig({ env })` 启动时统一解析(`TOBY_*` 环境变量);不在导入时解析全局配置,入口显式传入,测试可注入独立 `env`。
- 前端/packages 的 `.ts` 由 Node 22 直跑、无构建;服务端经 `nest build` 构建。各包风格规则见 AGENTS.md(`erasableSyntaxOnly` 仍对前端/packages 生效)。
- 执行目录调整时,同步更新本文与受影响文档的路径引用;长期取舍新增 ADR 到 `docs/decisions/`。完整的维护规则见[文档维护决策](decisions/living-docs.zh.md)。

## 术语表

本仓库中带特定含义的术语,每词一行——权威定义见该术语首次出现处。

| 术语                                    | 含义                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 提案 / 提案卡(proposal / proposal card) | 短期的、需用户确认的写入建议;确认之前不写入任何数据                                                |
| 提案确认内核(actions kernel)            | `infrastructure/actions/` 中的共享提案确认状态机(30 秒默许窗口、TTL 兜底、单飞 commit)             |
| 安全分级(safety kind)                   | 工具注册时的类别:`read-only`(无状态改变)或 `write-intent`(只能经提案产生效果);`costly` 为将来预留  |
| 门控(policy / shape / health gate)      | 三类强制点:policy = agent 可调用的工具分级;shape = TypeBox schema 校验;health = 开发期启动就绪检查 |
| 信任边界(trust boundary)                | 服务端确定性校验——AI 输出(以及一切外来输入)通过校验之前都是非受信的                                |
| 适配 port(adapter port)                 | ports-and-adapters 意义上的 port:SQLite / MySQL 在其后替换的接口                                   |
| 组合根(composition root)                | `apps/server/src/main.ts` —— 跨域接线唯一发生的地方                                                |
| 垂直域切片(vertical domain slice)       | 一个业务 = 一个目录,自含 controller、service、store 与规则                                         |
| 模块化单体(modular monolith)            | 模块在代码层隔离,由单进程装配运行                                                                  |
| 单飞(single-flight)                     | 并发确认与清扫任务合并为同一次执行                                                                 |
| 错误包络(error envelope)                | 统一的 `{ error: { code, message } }` 响应结构                                                     |
| 清扫任务(sweeper)                       | 周期任务:自动写入到期的提案并清理已过期的记录                                                      |

中文域名对照:记账=ledger、对话=chat、问候=greeting、日程=schedule、手账=notes、待办=todo、记忆=memory、书库=library。
