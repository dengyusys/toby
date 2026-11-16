# @toby/contract

双 Web 应用(`apps/web` 与 `apps/web-mobile`)的共享契约包:两端必须完全一致的 API 客户端、线上类型、请求逻辑——只留一份,以 TypeScript 源码直接消费。

这个包为什么存在:[docs/decisions/contract-package.zh.md](../../docs/decisions/contract-package.zh.md)

## 这里放什么

| 模块                     | 镜像服务端的                            |
| ------------------------ | --------------------------------------- |
| `src/request-json.ts`    | 共享请求封装与 `ApiError`(线上错误形状) |
| `src/system-client.ts`   | `/api/system/*`                         |
| `src/ledger-client.ts`   | `/api/ledger/*`                         |
| `src/memory-client.ts`   | `/api/memory/*`                         |
| `src/schedule-client.ts` | `/api/schedule/*`                       |
| `src/settings-client.ts` | `/api/settings/*`                       |
| `src/auth-client.ts`     | `/api/auth/*`                           |
| `src/chat-client.ts`     | `/api/chat/*`                           |
| `src/pi-messages.ts`     | PI 运行时消息形状(仅类型)               |
| `src/trace-events.ts`    | trace 事件形状(仅类型)                  |

## 准入三问——什么永远不进来

"纯逻辑"本身不是门槛;客户端的常量也是纯的。这里的每个文件都必须对应服务端定义的某个表面,且下面三条全部成立:

1. 它镜像服务端定义的某个东西——线上形状、错误码、接口——或由其直接派生。
2. 两端各一份且内容不同时,会有一端**不正确**,而不只是不一致。
3. 服务端接口变更可能迫使这个文件跟着改。

任何一条不成立,代码就归各应用(各端 `features/<domain>/<domain>-view.ts` 是既有模式;双应用拆分本来就接受这种重复)。常见的否决项:客户端缓存 key、视图 helper、格式化/解析工具。

## 硬规矩

- 零运行时依赖;**零 JSX、零 CSS、零 DOM**——不引 `react`,不碰 `window`/`document`;这个包在不启用 DOM lib 的前提下通过类型检查。
- 纯 TypeScript 源码直接消费(深路径 + `.ts`);不构建、不发布。
- 依赖方向永远 `apps → packages`:这个包永不导入应用或服务端代码。
- 这里的变更同时作用于两端——落地前在仓库根目录跑 `pnpm run check`。

## 测试

`pnpm --filter @toby/contract run test`——各客户端的线上行为由 `test/` 固定(auth、ledger、memory、settings、system)。
