# 为什么用原生 Fastify

[English](fastify-server-stack.md) | 简体中文

服务端真正需要的东西很少:几条 JSON 路由、一个错误体、一道会话校验、一个请求体
上限,以及两处静态挂载。在这个规模上,框架的容器、模块图与装饰器管道付出的代价
大于回报——装饰器元数据编进每一次构建(测试里还得靠 swc 转换复刻一遍)、服务端
成了全仓唯一豁免可擦除语法规则的包、测试脚手架要先重建一遍模块图才能发第一个请求。

Fastify 恰好把承重的那几样作为普通、成文、标准的部件交给我们:按解码后路径匹配
的路由(编码过的路径变体照样落到该路由及其守卫上)、请求体上限、生命周期钩子、
唯一的错误处理器与 not-found 处理器、插件封装,以及在测试里不开 socket 就能走完
完整请求生命周期的 `inject`。其余都是普通 TypeScript:服务是对显式依赖的闭包工厂,
装配就是普通的函数调用。没有装饰器、没有容器、没有反射——服务端与其他包遵循同一套
可擦除语法规则,用纯 `tsc` 编译。

还有一个驱动因素取决于代码由谁来写:本仓库以 agent 优先开发,而 agent 的可靠
产出跟随语料密度。NestJS 的承重层——装饰器、provider token、模块图——恰在模型
语料最稀疏的地方:agent 复现得了表面(一个 controller、一个 module),底下的连线
实际仍停留在底层平台;而这些元编程连线恰恰是评审者无法靠通读核对的行。原生
Fastify 加闭包工厂让每个承重件都留在语料密集区——路由表、钩子、`inject`、普通
函数调用——那也正是评审者能逐行核对的区域。

## 在本仓库中

- `src/composition-root.ts` 是组合根:HTTP 外壳(请求体上限、错误边界、not-found 回答、
  `no-store`、cookie、SPA 挂载)与域的装配顺序。`src/main.ts` 只负责解析配置、
  监听,以及收到信号时关闭。
- 每个域保留三种角色文件:`routes.ts`(HTTP 壳,一个 Fastify 插件)、
  `service.ts` / `db.ts` / `repository.ts`(不含 HTTP 导入的闭包工厂)、`plugin.ts`
  (装配,并经 `onClose` 管理生命周期)。
- 会话守卫是一个异步 `preHandler`,由组合根默认装在每条 `/api` 路由上;路由以
  `config: { public: true }` 显式豁免(health 与 auth 端点)。静态页面永远不挂——
  登录页必须能匿名加载。
- 唯一错误体:`DomainHttpError` 原样透传,框架 4xx 配上由状态码推出的 code,
  其余一律是净化后的 500。

本决策取代原先的 NestJS 决策(NestJS 12,跑在 Node HTTP 适配器上)。线上契约没有
变化——根目录的 HTTP 集成测试在切换全程钉住了它,并与旧服务做过逐请求的差分比对;
去掉的是容器、装饰器及其工具链(`@nestjs/*`、`reflect-metadata`、`rxjs`、swc 测试
转换、`supertest`)。少数字节级细节不同但无语义影响:错误 message 文本、Set-Cookie
属性顺序、`/m` 重定向的空响应体、`/m/..` 的重定向应答、`.js` 的 Content-Type、
416 的提示性响应头,以及畸形 HTTP 请求的 client-error 响应体。
