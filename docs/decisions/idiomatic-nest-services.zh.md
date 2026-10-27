# 惯用法 Nest 服务:类、构造器注入、元数据守卫

[English](idiomatic-nest-services.md) | 简体中文

服务端保留 [nestjs-server-stack.md](nestjs-server-stack.zh.md) 的
NestJS-over-Fastify 技术栈,但放弃"只有壳"的迁移风格:服务是带构造器
注入的 `@Injectable()` 类,域模块是声明式 `@Module` 类,认证是带
`@Public()` 元数据豁免的真正的 Nest 守卫,测试经 `@nestjs/testing`
装配应用。

## 为什么

- **当初的阻塞前提已经失效。** 旧 ADR 规定 `@Inject(token)` 属性注入,
  理由是 vitest 的 esbuild 转换不产出装饰器元数据。两个事实瓦解了它:
  当前 lockfile 里 server 的 vitest 解析到 Vite 8(oxc)管线,本来就产出
  `design:paramtypes`;而 NestJS 官方配方(`unplugin-swc`)可以显式钉住
  该行为、不依赖 pnpm 选择哪个 vite peer。两条路径都由
  `apps/server/test/infrastructure/di-metadata.test.ts` 守护——元数据
  一旦不再产出,该测试第一时间红。
- **主流惯用法,自家边界。** 类 token 上的构造注入、`forRoot` 值模块、
  生命周期钩子、`Test.createTestingModule` 是每个 Nest 开发者(和模型)
  都熟知的形状——与当初迁移的理由相同,这次推到服务层。垂直域边界
  (vertical-domains.md)未动,仍由测试机器强制。

## 决策

- **工具链。** `apps/server/vitest.config.ts` 让全部 server 测试经
  `unplugin-swc` 转换(`@swc/core` 的二进制随 optionalDependencies
  分发;其 postinstall 在 `pnpm-workspace.yaml` 保持阻断)。元数据回归
  测试守护这一前提。`nest build`(tsc)不变。
- **服务与 store 是类。** `SystemService`、`AuthService`、
  `LedgerStore`、`LedgerService` 经构造器收依赖。值型或可选依赖保留
  token:组合根里 `SharedProvidersModule.forRoot` 全局提供的
  `TOBY_CONFIG` / `CLOCK`,以及 ledger 的
  `LEDGER_EXTRACTOR` / `LEDGER_TIMING`(测试可覆写的旋钮)。日志用内置
  logger 的 `new Logger(X.name)` 门面——不注入 logger token,测试经
  `Logger.overrideLogger` 收集。按类的服务
  token(`SYSTEM_SERVICE`、`AUTH_SERVICE`、`LEDGER_SERVICE`)全部废除,
  假 `*_LIFECYCLE` provider 也一样——服务经标准生命周期钩子持有自己的
  后台定时器。
- **配置只解析一次,先于 Nest。** `resolveConfig()` 在组合根运行
  (fail-fast 时序不变),以 `TOBY_CONFIG` 值进入容器。有意不引入
  `@nestjs/config`:解析出的强类型对象就是唯一经过校验的来源,测试注入
  显式 env 对象而非 `process.env`,且 Fastify 适配器在容器存在之前就
  需要配置。
- **校验保持 typebox;不设全局 ValidationPipe。** ledger 草稿 schema
  同时是面向模型的工具契约与服务端 shape 门——换成 class-validator DTO
  会把一鱼两吃拆成两份可漂移的定义。全局管道还会接管 body 解析,威胁
  `FST_ERR_*` → `INVALID_JSON` / `PAYLOAD_TOO_LARGE` 的包络映射。未使用
  的 `class-validator` / `class-transformer` 依赖已移除。
- **认证是带元数据豁免的守卫。** `SessionGuard`(`@Injectable`,
  `Reflector`)依据 `@Public()` 路由元数据判豁免——绝不解析请求 URL。
  旧守卫按原始 URL 前缀匹配而路由器按解码路径匹配,`/%61pi/ledger/months`
  因此以"不在 /api 下"的名义进入被守卫的路由(实测可利用;现为回归
  测试)。`GET /api/system/health` 标记 `@Public`——它是 Docker
  healthcheck 目标且不含业务数据(用户 2026-10-27 决策;代码与
  `docs/features/system.md` 契约重新对齐)。异常过滤器里的 405 判别同样
  改为先解码路径。
- **守卫显式安装。** `APP_GUARD`(任何 `APP_*` 增强器 provider)在当前
  工具链下不可用:Nest 12 ESM 在 vitest 模块运行器里,任何
  `APP_GUARD`/`APP_FILTER` 注册都以 "metatype is not a constructor"
  失败——用零依赖守卫在 TestingInjector 与 NestFactory 两条路径、带与
  不带 swc、12.2.0 与 12.3.2 上均复现(被构造的是一个内部 metatype 为
  空的 wrapper)。因此组合根把容器构建的守卫交给 `applyHttpContract`
  (`useGlobalGuards`,在 `app.init()` 之前安装;main 传惰性解析的委托)。
  Nest 修复 ESM 增强器注册后重新评估。
- **db port 保留;store 自持数据库。** `LedgerStore` 以备忘录式惰性开库
  (首个调用者付代价,之后共享)并执行迁移,`OnModuleDestroy` 关库——
  单一消费者,不需要额外的 token 或工厂间接。为何不用 ORM 见
  [db-adapter.md](db-adapter.zh.md)。
- **不引入 `@nestjs/schedule`。** auth 与 ledger 的 service 在
  `onModuleInit` 里启动 sweep `setInterval`、`OnModuleDestroy` 里清理,
  保住全部时间参数的可注入性(`CLOCK`、`LEDGER_TIMING`)——测试套件
  依赖这一点。ledger 定时器先于数据库关库的销毁顺序由 Nest 按依赖深度
  降序销毁保证——不要切断 LedgerService → LedgerStore 的依赖链。
- **测试。** HTTP 契约套件经 `test/app-fixture.ts` 装配应用:
  `Test.createTestingModule` + `overrideProvider` 覆写逐 case 的值,
  `createNestApplication` 用与生产相同的适配器和
  `applyHttpContract`。单元套件直接构造类
  (`new LedgerService(...)`)。黑盒
  `test/http-contract.integration.test.ts`(spawn `dist/main.js`)仍是
  wire 契约的最终裁决者,并新增 health 公开与编码路径行为钉子。

## 原样保留的部分

`RawErrorFastifyAdapter`、`app.init()` 先于 `inject()`、根模块必须是
装饰类的约束(因此 `createAppModule` 仍是工厂)、`abortOnError: false`、
精确钉版的 Fastify 5.12.7、私有 `staticAssetsPlugin`、信封优先的响应
写出(`sendJsonReply`)——依旧载重,依旧有测试锚定。
