# Toby 重构框架搭建计划

> 状态:bootstrap 与远端仓库已完成,server 框架、web 骨架与数据库适配 port 三批已进 main;待办:CI/Docker 批次。合并方式已定为**直接 push main**(本地 check 全绿即推,不走 PR)。

## 背景(Context)

Toby 是自托管个人助手(定位:像贴身书童,记录日程、笔记,管理项目文件),是对旧项目 `D:\ai-steward-a` 的规范化重写。旧项目约 18 万行、9 个功能域,架构有纪律(垂直域切片 + ESLint 强制隔离 + ADR + ~570 测试),但流程缺失:无 CI、无 review、提交随意、web/web-mobile 49 个文件复制。

**本次只搭框架**(骨架 + 规范 + CI + Docker),功能后续以独立提交逐步迁移。核心策略:复用旧项目验证过的形态,重立工程规范,消除双端复制。

## 已确认决策

- 技术栈沿用旧栈:Node 22 直跑 .ts(无构建)+ pnpm workspaces + Fastify 5 + better-sqlite3 + React 19/Vite 6/Tailwind v4/shadcn + vitest
- 数据库访问:自建适配 port,推荐 SQLite;MySQL 适配器出于作者学习目的,第三种数据库加入只需再加一个适配器(不引入 ORM/查询构建器,domain store 手写 SQL、类型安全自维护;见 docs/decisions/db-adapter.md;方案已定,实现为批次四)
- 后端服务命名:**`server`**(目录 `apps/server`、包名 `@toby/server`、组合根 `src/main.ts`、文档术语"服务端 / Toby server"),不用旧项目的 gateway
- 保留"对话→AI提案→确认→写入"模式,框架期仅做**架构预留**(ADR + 文档,不写代码)
- 前端双应用(apps/web + apps/web-mobile)+ 共享包(packages/contract 纯逻辑);组件与样式各端自持、永不共享(见 docs/decisions/web-split-dual-apps.md)
- 部署 Docker Compose
- 端口:**8629 块**(8629 = T9 键盘上的 TOBY),按角色排序:server `8629`(开发与生产同端口,永远是服务端)、开发 web `8630`、开发 web-mobile `8631`,Docker 只绑 `127.0.0.1:8629`。与旧项目 4173/4174/4176 错开,迁移期两项目可同机并行
- GitHub:Actions CI(lint/typecheck/test/docker)、dependabot、CODEOWNERS、Issue 模板;**不走 PR**(改动直接 push main,门禁是本地 check 全绿),不设 Rulesets

## 语言规范

- **Git 提交:英文**,Conventional Commits,scope 用英文域名(如 `feat(schedule): add month view`)
- **代码注释:英文**
- **README 双语**:`README.md`(英文)+ `README.zh.md`(中文),顶部互链 —— 已完成
- **AGENTS.md / CONTRIBUTING.md 双语**:英文为主 + `.zh.md` 中文版,顶部互链 —— 已完成
- **单文件配置注释中英双语**:无法出 `.zh` 版本的文件(`.gitignore`、`.gitattributes`、`.editorconfig`、`.npmrc`、`.env.example`、后续 `commitlint/eslint` 等配置)注释一律双语,且**同一段注释英文块完整在前、中文块完整在后,不逐行穿插** —— 已完成存量五个;JSON 类无法写注释的除外
- 项目文档(docs/):英文为主(`.md`)+ `.zh.md` 中文对照,与 README 同构

## 目标文件树(骨架完成形态)

```
toby/
├── .gitattributes .gitignore .nvmrc(22.23.2) .editorconfig .env.example
├── .prettierrc.json .prettierignore commitlint.config.js eslint.config.js
├── package.json                 # 根:scripts + simple-git-hooks + lint-staged
├── pnpm-workspace.yaml          # apps/* packages/* + allowBuilds(esbuild/better-sqlite3)
├── tsconfig.base.json           # strict + erasableSyntaxOnly + verbatimModuleSyntax 等
├── tsconfig.json                # 根:覆盖 test/ scripts/
├── vitest.config.ts             # 根集成测试
├── Dockerfile compose.yaml .dockerignore
├── LICENSE                       # MIT(版权行:dengyusys, 2026)—— 已完成
├── AGENTS.md + AGENTS.zh.md     # AI 代理指南(英文 + 中文,互链)—— 已完成
├── CONTRIBUTING.md + CONTRIBUTING.zh.md  # 贡献指南(英文 + 中文,互链)—— 已完成
├── README.md + README.zh.md    # 双语 README(英文 + 中文,互链)—— 已完成
├── .github/                     # CODEOWNERS dependabot.yml PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/          # config.yml bug_report.yml feature_request.yml
│   └── workflows/ci.yml         # lint/typecheck/test/docker 四 job
├── docs/
│   ├── README.md product-overview.md system-overview.md
│   ├── decisions/               # ADR 无编号、按名称(已写:垂直域切片/双端拆分/共享契约包/服务端技术栈/前端技术栈/AI 接入/文档维护/开发编排/数据库 port;待写:monorepo/无构建直跑/提案管线预留)
│   ├── features/               # 各域目标契约(9 份已迁入;system 走通域契约随框架提交立)
│   └── operations/              # local-dev.md docker-deploy.md
├── scripts/dev.js               # 开发编排:server 8629 先起,再拉 web 8630 / web-mobile 8631
├── test/http-contract.integration.test.ts
├── data/.gitkeep
├── apps/server/                 # @toby/server(后端单进程)
│   └── src/
│       ├── main.ts              # 组合根:resolveConfig → assembleSystem → createServer → listen
│       ├── infrastructure/      # config(TOBY_* env)/http(createServer 工厂+错误包络+双SPA静态)/logging(pino)/db(适配 port:sqlite/mysql 适配器,可扩展)
│       └── domains/system/      # 走通域:module.ts router.ts(health/info) types.ts
│   └── test/                    # app.inject 测试 + sqlite 临时目录测试 + mysql 门控测试(TOBY_TEST_MYSQL_URL)
├── apps/web/                    # @toby/web,PC 端入口 /
│   └── src/...                  # HashRouter + QueryClient + features/system/HealthPage
├── apps/web-mobile/             # @toby/web-mobile,入口 /m/,base /m/,端口 8631
└── packages/
    └── contract/                # @toby/contract,纯 TS 零 JSX:requestJson + system-client
```

## 关键设计

### 1. 走通骨架:system 域(长期保留)

- `GET /api/system/health` → `{"status":"ok"}`;`GET /api/system/info` → name/version/node/started_at/uptime_seconds
- 错误同构包络 `{"error":{code,message}}`;404 PAGE_NOT_FOUND、405 甄别
- **每层有测试**:server(app.inject)、contract(stub fetch)、双 web(健康页断言)、根 HTTP 集成测试 → CI 全绿即框架成立
- `main.ts` 组合根保持"每域一行装配",后续业务域提交只是加行

### 2. 双端组件自持(无共享组件包)

- 组件、样式、主题永不跨端共享(见 docs/decisions/web-split-dual-apps.md);`@toby/contract` 是唯一共享通道,且永远零组件零样式
- 每个 app 自己的 `components.json`(标准单应用 shadcn 布局)+ `src/components/ui/`,`shadcn add` 写入各自仓库
- Tailwind v4 主题:各 app 的 `src/index.css` 自带 `@theme` 与基础样式;同一组件改两遍是已接受的代价
- 验证:`pnpm build` 后各 dist CSS 含健康页用到的类

### 3. ESLint 边界纪律(数据驱动白名单,裁剪自旧项目)

- `DOMAIN_ALLOWED` 表:域互不导入,新域登记一行自动生成规则
- 基础设施禁导入域(装配只在 main.ts 与各域 module.ts);域内 types.ts 纯净(禁 fastify/infrastructure/node:)
- 双 web 互不导入,共享仅经 `@toby/contract`;前端包禁导入 `@toby/server`

### 4. 工具链

- Prettier(endOfLine lf)+ commitlint(config-conventional,英文主题开箱即用)+ **simple-git-hooks + lint-staged**(prepare 自动装钩子)
- 钩子:pre-commit → eslint --fix + prettier;commit-msg → commitlint

### 5. GitHub(gh CLI 创建私有仓库 toby,默认分支 main)

- `git branch -m master main` → 首提交 → `gh repo create toby --private --source . --push`
- 不设分支保护、不走 PR:门禁前移到本地 `pnpm run check` 全绿;dependabot 的升级 PR 是唯一例外(机器开出,一键合并)
- ci.yml:push main 触发;四 job(lint、typecheck、test、docker build),作为事后保险而非合并门禁;concurrency 取消旧跑
- dependabot:npm 周更全量分组(前缀 `chore(deps): `)+ docker + actions;CODEOWNERS `* @dengyusys`
- Wiki:docs-as-code 优先,docs/ 内容后续手动同步 Wiki(记录在根 README)

### 6. Docker

- 多阶段:build 阶段 pnpm install --frozen-lockfile → pnpm build → `pnpm --filter @toby/server deploy --prod /pruned`;运行阶段 node:22-bookworm-slim,保留 monorepo 相对布局(`node apps/server/src/main.ts`),ENV TOBY_HOST=0.0.0.0
- **预案**:pnpm deploy 产物异常则退级 COPY 全量 node_modules,实测拍板记入 docs
- compose:服务名 `server`(镜像 toby)、端口只绑 127.0.0.1:8629、`./data:/app/data` 卷、healthcheck 打 /api/system/health、env_file 可选、可选 mysql service(compose profile `mysql`,仅 TOBY_DB_DIALECT=mysql 时启用,绑 127.0.0.1:3306,utf8mb4)
- .dockerignore 必含 `**/dist`(镜像内重新构建)

### 7. 版本要点(沿用旧项目实测组合)

fastify ^5.12.3、@fastify/static ^10.1.3、better-sqlite3 ^13.0.3、mysql2 ^3.24.6(数据库驱动各配各的适配器、共用一个 port;mysql2 纯 JS、自带类型、无需 allowBuilds)、zod ^4.6.4、pino ^10.1.0、react 19、vite 6、@tailwindcss/vite ^4.3.3、@tanstack/react-query ^5.104.1、react-router ^8.3.1、vitest ^5、happy-dom、@testing-library/*、typescript ~6.0.3、pnpm 11.18.0(packageManager)。版本单一真相关在 `pnpm-workspace.yaml` 的 `catalog`,各 package.json 以 `"catalog:"` 引用。**不引入**:openai、sqlite-vec、Python(随业务域提交进)

### 8. AGENTS.md(英文 + 中文)—— 已完成(不设 CLAUDE.md,AI 规则统一走 AGENTS.md)

按业界共识的标准章节组织:项目简介(两三行 + 指向 README/docs)/ 命令表 / 测试约定(含"改什么跑什么")/ 目录结构(含边界纪律)/ 代码风格 / Git 工作流(含"AI 未经审批不得提交"铁律)/ 边界与安全。架构叙事(mermaid 图、提案管线流程)只在 docs/system-overview.md,不进 AGENTS.md。

## 提交序列(实践规范工作流)

main 直接 bootstrap(保护规则生效前的鸡生蛋问题):

1. `chore(repo): initialize pnpm workspace and root configs` → 推送、建远端
2. `chore(tooling): add ESLint boundary rules, commitlint and git hooks`
3. `docs(architecture): establish documentation skeleton and project rules`

随后直接 push main(本地 `pnpm run check` 全绿即推,不走 PR):

- 批次一 server 框架(已进 main):④ `feat(server): Fastify app factory and infrastructure skeleton` ⑤ `feat(system): walking-skeleton domain with health endpoints` ⑥ `feat(contract): pure contract package with system client`
- 批次二 web 骨架(已进 main):⑦ `feat(web): minimal web and web-mobile skeletons with health page`(各端自持主题与组件),辅以 `chore(deps)` catalog 与 `docs(plan)` 等规范提交
- 批次三 CI/Docker:⑨ `chore(dev): dev orchestration script and root integration tests`(已进 main)⑩ `ci(collaboration): Actions pipeline, dependabot and templates` + `build(deploy): Docker image and compose stack`
- 批次四 数据库适配 port(方案 ADR 已先行进 main;实现已进 main):⑪ `feat(server): database port with sqlite and mysql adapters` —— `infrastructure/db` 重构为适配 port(types/errors/sqlite/mysql/create-db/migrate,吸收现有 open-database.ts)、config 增 TOBY_DB_* 数据库段、catalog 增 mysql2、port 级 contract 测试套件(mysql 部分由 TOBY_TEST_MYSQL_URL 门控、默认 skip);已同步跟进 system-overview / local-dev / .env.example / todo / ledger 文档

## 验证(框架成立判定)

```bash
corepack enable && pnpm install
pnpm run check                    # typecheck + lint + format:check + test 全绿
pnpm run dev                      # server 8629 → web 8630 / mobile 8631
curl http://127.0.0.1:8629/api/system/health    # {"status":"ok"}
# 浏览器 127.0.0.1:8630 与 127.0.0.1:8631/m/ 显示健康页(证明 Tailwind 主题 + Query)
pnpm run build && pnpm run start
curl http://127.0.0.1:8629/ && curl http://127.0.0.1:8629/m/    # 单进程服务端直接服务双 SPA
docker compose build && docker compose up -d && curl .../health && docker compose ps  # healthy
```

CI:落地后每次 push main 跑四项检查,作为事后保险而非门禁。

## 风险与对策

- pnpm deploy 不确定 → 退级 COPY 全量 node_modules,实测拍板
- 双端组件/主题各写一份 → ADR 已接受此代价;复制时各自维护,不引入共享包
- better-sqlite3 原生构建 → 三平台有 prebuilt;Docker 构建失败则 build 阶段装 python3/make/g++
- Windows CRLF → .gitattributes + Prettier endOfLine lf 双保险
- fresh clone 无 dist → static-assets 对缺失 root 告警跳过(对旧版的小改进)

## 待审阅的开放问题

1. 项目文档(docs/)语言:已定 —— 英文为主 + `.zh.md` 中文对照,与 README 同构
2. GitHub 仓库名默认 `toby`、私有;如需公开或改名请注明
3. ~~Rulesets 分支保护~~ 已拍板:不走 PR、不设分支保护(2026-10,单人开发,门禁为本地 check)
