# Nest 增强器与请求校验

[English](nest-enhancers.md) | 简体中文

横切请求管道的各环节一律用 Nest 标准 `APP_*` 增强器注册——`APP_GUARD`
管会话守卫、`APP_FILTER` 管错误包络、`APP_PIPE` 管请求体校验——请求体用
Zod 4 schema 经 Nest 内置的 `StandardSchemaValidationPipe` 校验。这两条都
推翻了已删除的 `idiomatic-nest-services` ADR 曾经钉下的结论;本 ADR 恢复
决策链,并收留该 ADR 中仍然成立的规则。

## 为什么反转

- **`APP_*` 增强器现在能正常注册。** 旧 ADR 的 "metatype is not a
  constructor" 失败是在 Fastify 适配器时代的组装上复现的(vitest module
  runner 下的 Nest 12.2/12.3,开不开 swc 都复现)。在当前 platform-node
  栈上不复现:每个经夹具组装的测试应用都通过 `HttpModule` 注册了过滤器和
  管道,auth 测试套件再经 `APP_GUARD` 加上 `SessionGuard`,拉起
  `dist/main.js` 的集成套件则经 NestFactory 走到同样的注册。关键行为都有
  测试钉住:百分号编码路径的守卫用例(`APP_GUARD`)、错误包络
  (`APP_FILTER`)、400 / 413 包络映射(`APP_PIPE` 加适配器错误路径)。
- **Zod 取代 TypeBox 成为形状门。** 工具 schema 已迁移到 Zod(见
  [ai-pi-runtime.zh.md](ai-pi-runtime.zh.md));Zod 4 实现了 Standard
  Schema 接口,Nest 内置的 `StandardSchemaValidationPipe` 直接消费这些
  schema,零自定义管道代码。一份 schema 定义同时是面向模型的工具契约和
  服务端的形状门——正是旧 ADR 保留 TypeBox 想要的"单一定义"性质。旧顾虑
  (全局管道会吞掉请求体解析和传输层错误映射)随适配器切换而消解:
  platform-node 的错误路径喂给刻意设计的包络(`BAD_REQUEST` /
  `PAYLOAD_TOO_LARGE`),由 error-handler 套件钉住。

## 决策

- `HttpModule`(`infrastructure/http/http.module.ts`)持有全局
  `APP_FILTER`(`HttpExceptionFilter`)与 `APP_PIPE`
  (`StandardSchemaValidationPipe`);`AuthModule` 经 `APP_GUARD` 注册
  `SessionGuard`。域只为本域关注点注册增强器——绝不为别的域注册。
- 路由参数内联声明 schema——`@Body({ schema })`,Zod 对象放在
  `dto/login.dto.ts` 与 `dto/create-proposal.dto.ts`。形状失败在任何域代码
  运行之前以传输层 `BAD_REQUEST` 包络浮出;语义校验留在域内
  (`ledger/validation.ts`)。
- 装饰器元数据前提(vitest 下的构造注入)不变,仍由
  `test/infrastructure/di-metadata.test.ts` 守护。

## 旧 ADR 中仍然承重的规则

- `SessionGuard` 经 `@Public()` 元数据豁免路由——绝不解析请求 URL;百分号
  编码绕过是常驻回归用例。`GET /api/system/health` 是 `@Public`(Docker
  健康检查目标)。
- 不用 `@nestjs/schedule`:服务经 `onModuleInit` / `onModuleDestroy` 自持
  定时器,所有时间参数保持可注入。
- store 拥有自己的数据库——惰性备忘录式开库,模块销毁时关闭
  (见 [db-adapter.zh.md](db-adapter.zh.md))。
- 配置在启动时解析一次,发生在容器内(`SharedProvidersModule.forRoot`,
  `useFactory: resolveConfig`),坏环境会让 `NestFactory.create` 失败;类型化
  对象以 `TOBY_CONFIG` 值进入 DI,测试改写该 token 而非碰环境变量。不引入
  `@nestjs/config`。
