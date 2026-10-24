# 服务端运行于 Fastify 之上的 NestJS

[English](nestjs-server-stack.md) | 简体中文

服务端以 NestJS 12 + Fastify 适配器装配。引擎没换——仍是 Fastify
5——换的是组织方式:域是带 controller 的 Nest 模块,服务经 token 注入,
横切行为收进全局异常过滤器与全局守卫。

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
- **pino** —— 结构化 JSON 日志,低开销;不引入更重的可观测性套件。

## 迁移摸清的机制(非显然,动它们会让测试以迷惑的方式坏掉)

- **`inject()` 之前要 `app.init()`。** controller 在 `init()`(或
  `listen()`)期间才挂上适配器;测试路径不 listen,所以
  `createNestServer` 显式 init。
- **根模块必须是装饰过的类。** 纯 `DynamicModule` 对象当根:provider
  会实例化但路由永不注册。运行时组装用命令式应用 `Module` 装饰器;
  域模块可以是纯 `DynamicModule` 对象(标准 `forRoot` 形态)。
- **`@Inject(token)` 属性注入。** vitest 的 esbuild 转换不产出
  `emitDecoratorMetadata`,测试下构造注入拿不到元数据。显式 Symbol
  token 的属性注入在 tsc 与 esbuild 双通。token 放在各域的
  `tokens.ts`——从 module 文件反向 import 会造成循环导入,装饰器静默
  变成 `@Inject(undefined)`。
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
- **不用 `nestjs-pino`**:适配器直接跑共享 pino 实例
  (`loggerInstance`),访问日志字节与脱敏行为保持不变。
- **class-validator/class-transformer 暂缓**:controller 内请求体解析
  保持手写,HTTP 行为逐字节保持;引入 `ValidationPipe` 是另行确认的
  独立步骤。

## 命令

命令语义见 `AGENTS.md` 与 `docs/operations/`;一条无法推理出的约束:
Docker 落地时,镜像必须用 Node ≥ 22.19(pi-ai 的 engines 要求 +
`engine-strict=true`)。

---

## 参考

本决策吸收了原 server-stack.zh.md(已于 2026-10-24 退役,可从 git
历史取回);"其余技术栈"一节的原有选型原样延续。
