# 服务端运行于 Fastify 之上的 NestJS

[English](nestjs-server-stack.md) | 简体中文

服务端以 NestJS 12 + Fastify 适配器装配。引擎没换——仍是 Fastify
5——换的是组织方式:域是带 controller 的 Nest 模块,服务是带构造注入的
`@Injectable()` 类(落地过程见
[idiomatic-nest-services.zh.md](idiomatic-nest-services.zh.md)),横切行为
收进全局异常过滤器与全局会话守卫。

## 为什么

- **用成熟框架的约定取代私有约定。** 限流、校验、OpenAPI、生命周期
  钩子交给生态;结构则是每个模型与协作者都已熟悉的
  module/controller/provider/guard。
- **所学可迁移到 Spring Boot。** 模块≈配置扫描、provider≈Bean、
  guard/interceptor/pipe≈filter/interceptor/validator——学 Nest 就是学
  Spring 的骨架。
- **有意取舍:** 放弃零构建、.ts 直跑。`nest build`(tsc)产出
  `dist/`;`start` 与开发 watch 都从构建产物运行。

## 其余技术栈

框架期选型的准则仍然统治一切:**自托管、单用户、单进程 —— 一切让位于
简单可控。**

- **SQLite,经 db 适配 port 访问**(见 [db-adapter.zh.md](db-adapter.zh.md)):
  一个文件就是一个数据库 —— 无守护进程、无凭据,备份即复制 `data/`;
  同步驱动让事务就是一个普通函数调用,天然契合"确认后写入"模型。
  单写者的弱点在这里不存在:唯一写者、低频事务写入。MySQL 作为学习用
  适配器挂在同一 port 后;域代码看不到差别。
- **typebox** —— 一个 schema 库、一份定义:ledger 草稿 schema 既是面向
  模型的工具契约,也是服务端的形状门控;`typebox/value` 的
  `Check`/`Errors` 负责校验并定位出错字段,同一份错误文本还能作为
  工具错误回喂给模型。
- **Nest 内置 logger** —— `ConsoleLogger` 的 JSON 模式承担应用与框架
  日志(结构化参数,stdout 每行一条机器可读记录),服务侧用官方文档的
  `new Logger(X.name)` 门面。HTTP 访问日志仍归 Fastify 自己
  (`logger: { level }`,内部是 pino):默认序列化器只记
  method/url/host/IP,不记 headers——日志里本来就不含头字段,因此未配
  置脱敏(决策:暂缓;若将来序列化器纳入 headers 必须重议)。pino 不再
  是应用的直接依赖。

## 迁移摸清的机制(非显然,动它们会让测试以迷惑的方式坏掉)

- **`inject()` 之前要 `app.init()`。** controller 在 `init()`(或
  `listen()`)期间才挂上适配器;测试路径不 listen,所以
  `applyHttpContract` 显式 init。
- **根模块必须是装饰过的类。** 纯 `DynamicModule` 对象当根:provider
  会实例化但路由永不注册。运行时组装用命令式应用 `Module` 装饰器;
  域模块可以是纯 `DynamicModule` 对象(标准 `forRoot` 形态)。
- **全面构造器注入(取代属性注入规则)。** 本 ADR 最初规定
  `@Inject(token)` 属性注入,理由是 vitest 的 esbuild 转换不产出
  `emitDecoratorMetadata`。server 测试现经 `unplugin-swc` 转换
  (`apps/server/vitest.config.ts`),与 tsc 构建一样产出装饰器元数据,
  `test/infrastructure/di-metadata.test.ts` 钉住该前提——构造注入在
  构建与测试下行为一致。值型依赖仍用 token;见
  [idiomatic-nest-services.zh.md](idiomatic-nest-services.zh.md)。
- **`RawErrorFastifyAdapter`。** 原版适配器把 `FastifyError` 重写成
  `HttpException`,丢掉 `FST_ERR_*` 码(异常过滤器靠它映射
  `INVALID_JSON`/`PAYLOAD_TOO_LARGE` 公共包络);子类放行原始错误。
- **404/405 判别收进过滤器。** Nest 默认 not-found 抛
  `NotFoundException`;全局过滤器接住后判别 405(路径在其他方法下
  存在)与 404 包络,与此前行为逐字节一致。
- **`abortOnError: false`。** Nest 默认在 DI 失败时 `process.abort()`
  吃掉错误(vitest worker 以 SIGABRT 暴死);关掉后错误正常浮出。
- **Fastify 精确钉 5.12.7** —— 与 `@nestjs/platform-fastify` 解析的
  副本一致;任何其他解析都会让 Fastify 的类型与实例分裂成两份。

## 对迁移计划的有意偏离

- **不用 `@nestjs/serve-static`**:现有 `staticAssetsPlugin`(挂在
  适配器实例上)本就以与之前完全相同的语义服务两个 SPA 根——它就是
  计划里的回退选项,且已被验证。
- **不用 `nestjs-pino`**:应用日志已在内置 logger 上,没有需要它统一
  的东西了;访问日志由 Fastify 自带,走同一个 `TOBY_LOG_LEVEL`。
- **typebox 保留;class-validator 已移除(已决)。** 暂缓的
  ValidationPipe 采纳最终决定不做:ledger 草稿 schema 同时是 AI 工具
  契约与服务端 shape 门,全局管道还会接管 body 解析、威胁 `FST_ERR_*`
  包络映射。未使用的 class-validator/class-transformer 依赖已删除——见
  [idiomatic-nest-services.zh.md](idiomatic-nest-services.zh.md)。

## 命令

命令语义见 `AGENTS.md` 与 `docs/operations/`;一条无法推理出的约束:
Docker 落地时,镜像必须用 Node ≥ 22.19(pi-ai 的 engines 要求 +
`engine-strict=true`)。

---

## 参考

本决策吸收了原 server-stack.zh.md(已于 2026-10-24 退役,可从 git
历史取回);"其余技术栈"一节的原有选型原样延续。
