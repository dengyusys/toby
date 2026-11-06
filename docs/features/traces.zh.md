# 轨迹域（Traces）：AI 调用监控

[English](traces.md) | 简体中文

> 目标契约:所有 AI 调用的实时观测通道;实现细节以代码与测试为准。

## 职责与边界

AI 运行时(docs/decisions/ai-pi-runtime.md)的可观测性配套:每次模型调用——工具循环 agent 与单发 client 一视同仁——都会上报到一个内存轨迹总线,本域把总线流式推给 web 监控面板。控制台语义,浏览器控制台那样:**什么都不存**——调用发生前已接入的观察者能看到,后加入的看不到,服务端重启即清空。

- **管**:`GET /api/traces/stream`,唯一的 SSE 端点。
- **不管**:任何持久化(没有 `data/` 文件、没有历史查询 API);捕获本身(那是 `infrastructure/trace/`,由模型层调用)。

## 核心概念

- **轨迹总线**(`infrastructure/trace/bus.ts`):只做扇出。组合根创建一个总线实例,同时交给 AI 运行时(作为上报器)和本域(作为流来源)——这是唯一的跨域接线,在 `composition-root.ts` 完成。
- **每次调用两个事件**:`run-started` 在调用开始瞬间发出(提示词立即上屏,带运行中标记);`run-finished` 收尾,带完整 transcript——系统提示词与工具声明、用户输入、含思考/工具调用的助手轮次、工具结果——以及结果、用量(tokens、费用)与耗时。`run-finished` 自包含:即使漏掉了 `run-started` 也能独立渲染。
- **捕获点**:`createTobyAgentFactory`(kind `agent`,label 取 spec 的 `name`,如 `ledger-extraction`)与 `createPiAiClient`(kind `single-shot`,label `complete`;JSON 重试是一次独立调用,纠正提示词清晰可见)。
- **面板**(仅 `apps/web`):布局右上角按钮开合的右侧抽屉——不跳页面,在当前页面旁分割出主区域。SPA 在整个登录会话期间持有同一个 EventSource(随受守卫路由挂载),任何页面上调用记录都持续流入——抽屉只是这条流的视图,浏览器内积累(有上限)。`apps/web-mobile` 刻意不做面板。

## 接口面

一个端点,与其余 `/api` 路由一样默认带会话守卫(transcript 属个人数据——不做 public 豁免):

| 方法与路径               | 用途                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /api/traces/stream` | SSE:`trace` 事件(`run-started` / `run-finished`),每 15 秒心跳注释,连接建立即发 `: connected` 帧 |

事件载荷(`TraceEvent`,镜像于 `packages/contract/src/trace-events.ts`):携带的 pi-ai 值一律原样——字段名、大小写、content 块结构与运行时产出完全一致(与对话 item 流同一套词汇);Toby 自有字段(`started_at`、`duration_ms`、`label` 等)保持 snake_case:

- `run-started` → `{type, run: {id, kind, label, model, prompt, started_at}}`
- `run-finished` → `{type, run: {…started 字段, duration_ms, status: "succeeded"\|"failed", messages, result_text?, error?, stopReason?, turns?, usage?}}`
- `messages` 条目为 pi-ai 消息原样(`system` 可带 `toolsAdded`、`user`、`assistant` 的 `content` 块含 `thinking`/`toolCall`/`text` 并附 `usage`/`stopReason`、`toolResult` 带 `toolCallId`);`usage` 与 `stopReason` 同为 pi-ai 原样值。

## 关键规则

- **永不存储。**总线不留历史,本域也不暴露历史;`data/` 分毫不动。历史属于观察者(页面自行设上限)。
- **观测通道绝不拖垮调用。**抛错的监听器被隔离;捕获尽力而为——上报失败,AI 调用照常执行。
- **新增 AI 调用路径不得绕过它。**任何未来的模型调用方(chat agent、分类器)都必须走带捕获的工厂/client;绕过者即本契约的缺陷。
