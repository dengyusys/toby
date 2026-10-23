# Toby 第二阶段：NestJS 迁移计划（定稿）

> 状态：**已实施（2026-10-23，分支 `feat/nestjs-migration`）** —— 三域 Nest 化、组合根切换、旧装配删除、全量测试与集成测试全绿；设计定稿见 [docs/decisions/nestjs-server-stack.md](docs/decisions/nestjs-server-stack.md)，本文档可随之归档 · 定稿日期：2026-10-22
> 审计修订：2026-10-22 —— 补 ESLint 审计结论（语法禁令全在 tsconfig）、fastify 插件盘点步骤、根 scripts 细化、双 SPA 静态根风险、Nest 版本核实项。
> **前置条件：阶段一（pi 迁移——设计定稿见 [docs/decisions/ai-pi-runtime.md](docs/decisions/ai-pi-runtime.md)，实施记录见 git 历史）已合入 main 后方可启动。两阶段绝不叠加在同一分支。**

---

## 〇、两阶段路线图

| 阶段                 | 内容                                                                                      | 产出与关系                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 一：pi 迁移          | AI 接入切换 pi 生态（pi-ai 传输 + pi-agent-core 提取 agent + actions 公共模块 + TypeBox） | **逻辑层全部框架无关**，阶段二只重接装配层，一行业务代码不浪费 |
| 二：NestJS（本文档） | 服务端骨架从手写 Fastify 组合根迁移到 NestJS                                              | 行为保持型重构；对外 HTTP 契约、数据、日志语义不变             |

## 一、目标与性质

- **目标**：引入成熟框架的结构（模块 / DI / 守卫 / 管道），对齐 Spring Boot 心智模型（学习与转 Java 的迁移目标）；通用横切问题交给生态（限流 / 静态服务 / 生命周期）；减少自研私有约定，提升 AI 协作开发的约定熟悉度。
- **性质**：行为保持型重构。**根级 HTTP 集成测试是不变的验收合同**，全程必须保持全绿。
- **非目标**：不重写业务逻辑、不换数据库、不动 pi 层逻辑（agent 工厂 / 提取 / 校验 / actions 原样平移，只重接装配）。

## 二、技术选型（定稿，实施时不再议）

1. **`@nestjs/core` + `@nestjs/platform-fastify`**：换的是架构组织方式，不是 HTTP 引擎——Fastify 本体保留。实施时确认 Nest 当前大版本与 Node 22 / Fastify 5 适配器的兼容矩阵，版本入 catalog。
2. **日志 `nestjs-pino`**：pino 语义与现有结构化日志延续。
3. **静态服务 `@nestjs/serve-static`**：继续以 `/`（PC）与 `/m/`（移动）两个 SPA 根提供两个前端。
4. **HTTP DTO 校验 `class-validator` + `class-transformer`**：对标 Spring 的 Bean Validation（学习目标对齐），仅用于 HTTP 边界；**AI 层保持 TypeBox**（pi 生态母语，阶段一定稿不反悔）。双轨各有其主，ADR 记录取舍理由。
5. **限流**：评估 `@nestjs/throttler` 替换手写的 trust-proxy 感知登录限流；**等价性测试不过则保留手写实现**（如实记录结论，不硬塞）。
6. **域边界双重强制**：Nest 模块封装（provider 不 export 即不可注入，运行时隔离）+ 保留现有 ESLint import 边界规则（静态检查），两道防线并存。
7. **测试**：保留 vitest 作为 runner（不换 jest）；新增 `@nestjs/testing` 的 `createTestingModule` 做 DI 装配测试（对标 `@SpringBootTest` 心智）。
8. **tsconfig 分域差异化**：仅 `apps/server` 开 `experimentalDecorators` + `emitDecoratorMetadata`、撤 `erasableSyntaxOnly`、解禁构造函数参数属性；`apps/web` / `apps/web-mobile` / `packages` 维持原有可擦除语法规则不动。（审计结论：ESLint 配置中无装饰器 / 构造参数属性的语法禁令，禁令全在 tsconfig——只需改编译选项与 ESLint 的 import 边界规则，无需删语法规则。）
9. **构建链**：`@nestjs/cli`（生产 `nest build`；开发 `nest start --watch`，server 端口 8629 语义不变）；生产入口 `node dist/main.js --env-file-if-exists=.env`；根 package.json scripts 与 Dockerfile 同步更新。
10. **配置**：保留手写 `resolveConfig`（纯函数、测试友好），经 provider 注入；`@nestjs/config` 记为 ADR 可选升级项。
11. **清扫器**：用 Nest 生命周期钩子（`onApplicationBootstrap` + `enableShutdownHooks`）承载 proposal 清扫；`@nestjs/schedule` 记为可选（学习对标 `@Scheduled`，需要时再加）。

## 三、实施步骤

### 0. 前置检查

- 确认阶段一已合入 main；`git status --short` 干净；从 `main` 切出 `feat/nestjs-migration`。
- 通读根级 HTTP 集成测试（行为合同），确认全绿基线；记录关键断言清单。
- **盘点 `@fastify/*` 插件与 `infrastructure/http/app.ts` 的全部钩子 / 中间件**，逐项列出 Nest 等价物或"经 FastifyAdapter 底层实例直接挂载"的迁移方式（清单先行，域迁移时照单执行）。

### 1. 工具链先行（最小可行骨架，风险前置）

- 依赖（catalog，`^` 风格与现有 server-runtime 组一致）：`@nestjs/common` `@nestjs/core` `@nestjs/platform-fastify` `reflect-metadata` `class-validator` `class-transformer` `@nestjs/serve-static` `nestjs-pino`；dev：`@nestjs/cli` `@nestjs/testing`。
- `apps/server/tsconfig.json` 覆盖编译选项；入口顶部 `import "reflect-metadata"`。
- 构建脚本（根 package.json）：`build` = 两个 web 构建 + `nest build`（server）；`dev` = `nest start --watch`（server 8629 语义不变）；`start` = `pnpm run build` + `node dist/main.js --env-file-if-exists=.env`。
- **先建一个只含健康检查的最小 AppModule**，把全链路（构建 / watch / Docker 构建 / 静态页可达 / CI）跑通，再动任何业务域。
- Dockerfile / CI 调整：构建产物 `dist/`；healthcheck 目标与端口不变。

### 2. system 域（最小域打样）

- `module.ts` 自装配 → `SystemModule`；路由 → `@Controller`；句柄 → providers。
- 打样价值：确立"域 → Nest 模块"的映射范式，后续两域照抄。
- 验收：域级测试 + 根集成测试相应子集全绿。

### 3. auth 域（守卫语义）

- `requestGuard` → Nest Guard（全局 `APP_GUARD` 或模块级，保持现有放行/拦截语义与顺序）；登录限流决策落地（throttler 或保留手写）；密码哈希 / 会话逻辑不动。
- 验收：登录与守卫相关集成测试全绿，**必须覆盖 trust-proxy 场景**（这是最近一次加固的主题）。

### 4. ledger 域（最大域，含 AI 装配）

- `LedgerModule`：controller + service / store providers；阶段一产出的 agent 工厂与 actions 注册经 provider 工厂注入；proposal 清扫器迁到生命周期钩子。
- 验收：提取 → 提案 → 确认 → 入库全链路集成测试全绿；AI 相关测试沿用假 `streamFn` / `fauxProvider`（阶段一基建，零改动）。

### 5. 组合根切换与旧装配删除

- `main.ts` → `NestFactory.create(AppModule, new FastifyAdapter({ trustProxy }))` + `enableShutdownHooks()`；`AppModule` 聚合三域模块。
- 删除 `infrastructure/http/app.ts` 旧装配与各域遗留的自装配代码；检查无并行实现残留。

### 6. 文档与规范

- **新 ADR `docs/decisions/nestjs-server-stack.md`（+zh）**：动机（学习 + Spring 迁移 + AI 协作 + 生态成熟度）；fastify 适配器选择；双轨校验取舍（HTTP class-validator / AI TypeBox）；边界双重强制；**明确记录放弃了零构建直跑并说明理由**（权衡透明的 ADR 才可维护）；`@nestjs/config`、`@nestjs/schedule`、`@nestjs/swagger`、`@nestjs/throttler` 作为可选项的取舍结论。`server-stack.md`（双语）标注被取代（保留历史）。
- **AGENTS.md / AGENTS.zh.md**：代码风格段更新（apps/server 允许装饰器与构造参数属性，其余包维持原规则）；命令表更新（dev / build / start 语义变化）；测试矩阵行更新。
- **PLAN.md**、**docs/system-overview.md**、**docs/operations/**（开发 / 构建 / 部署流程变化）、`docs/features/*` 仅装配描述处微调（契约不变，不触碰）。
- 检查全部文档链接与旧路径引用；`git diff --check`。

### 7. 验证与交付

- `pnpm install` → `pnpm run check`（typecheck / lint / format / test）全绿；根级 HTTP 集成测试全绿（行为合同）。
- 手动冒烟：登录、记账 AI 提案（真实模型小验收沿用阶段一清单，单独授权）、确认入库、`/` 与 `/m/` 两个 SPA 可用、日志格式不回退。
- 展示全部改动与建议 commit（按域分组的提交序列），**经批准后才提交**；合回 `main` 方式由用户决定。

## 四、明确不做（阶段二范围外）

- 不改 HTTP 契约、数据模型、日志语义；不动 pi 层逻辑与红线机制。
- 不引入 `@nestjs/config`、`@nestjs/schedule`、`@nestjs/swagger`、微服务、消息队列——全部记入 ADR 可选项，需要时单独加。
- 不动 `apps/web` / `apps/web-mobile` / `packages/contract` 的构建与语法规则。

## 五、风险与对策

| 风险                                                                 | 对策                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 装饰器化迁移引入行为差异                                             | 根集成测试是合同，每步全程跑；按域小步迁移，绝不三域一把梭                                            |
| throttler 与手写限流语义不等价                                       | 等价性测试不过即保留手写实现并记录                                                                    |
| 构建链在 Windows / Docker 的差异                                     | 第 1 步打样阶段就验证全链路，风险前置                                                                 |
| `@nestjs/serve-static` 双 SPA 根（`/` 与 `/m/`）的前缀回退顺序不确定 | 打样阶段实测；行为不等价则退回 FastifyAdapter 底层实例直接挂 `@fastify/static`（保持两个 SPA 根语义） |
| 依赖面扩大、升级噪音                                                 | 版本全部走 catalog；Nest 全家桶升级统一节奏（一次升完，不拆散）                                       |
| 装配层间接化影响排障                                                 | 保留 pino 结构化日志；DI 装配测试显式断言注入关系                                                     |

## 六、红线（与阶段一完全相同，框架无关）

1. **AI 输出永远是非受信输入**：TypeBox 合同关 + 手写语义海关。
2. **真实效果只有一条路**：proposal → 用户确认 → 事务执行。
3. **危险能力（shell / 文件 / 直连 DB）无工具定义**——货架缺位，不是拦截。
4. **自动化测试永不打真模型**。

## 附：学习笔记——NestJS ↔ Spring Boot 概念对照（迁移时随 ADR 沉淀）

| NestJS                                    | Spring Boot                             |
| ----------------------------------------- | --------------------------------------- |
| `@Module`                                 | `@Configuration` / 组件扫描边界         |
| Provider + `@Injectable`                  | Bean + `@Service` / `@Component`        |
| 构造函数注入                              | 构造函数注入                            |
| Guard / Interceptor / Pipe                | Filter / HandlerInterceptor / Validator |
| class-validator 校验 DTO                  | Bean Validation 注解                    |
| `@nestjs/testing` Test Module             | `@SpringBootTest` + `@MockBean`         |
| 生命周期钩子 / `@nestjs/schedule`（可选） | `@PostConstruct` / `@Scheduled`         |
