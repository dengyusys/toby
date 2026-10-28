# AI 接入运行在 pi 生态之上

[English](ai-pi-runtime.md) | 简体中文

本仓库的全部 AI 传输与 agent 执行运行在 pi 生态之上:以
[`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)
作为统一 LLM API,以
[`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
作为 agent 循环。以下护栏是这套决定的一部分。

## 为什么

- **一个依赖换来供应商自由:** 20+ 供应商(zai/GLM、OpenAI、Anthropic、
  DeepSeek……)共用一套 API;换模型是改一行配置,不是改代码。
- **agent-first 与产品同构:** 产品形态是"说一句话,确认后落库"。带
  schema 校验参数的工具调用是模型最原生、最可靠的结构化输出通道,优于
  "提示词求 JSON 再从散文里抠"。
- **纠错变成循环:** 不合格的草稿作为工具错误打回给模型自行修正,
  而不是一次盲目的整体重试。
- **可观测性白送:** 每次调用自带 token/成本用量,直接进结构化日志。

## 不变的部分(红线)

1. **信任边界是服务端确定性校验。** 工具 schema(Zod,在 pi 边界转成 JSON Schema)只约束*形状*;
   语义校验(金额换算为整数分、真实日历日期、条目上限)保留在各域手写。
   AI 输出——包括工具参数——永远是非受信输入。
2. **一切真实效果走 proposal → 用户确认 → 事务执行。** 共享的提案确认
   状态机在 `infrastructure/actions-kernel/` (`registry.ts`);
   agent 永不直写、永不替用户确认。
3. **禁区能力是缺位,不是被拦。** 没有 shell 工具、没有文件系统工具、
   没有直连数据库工具——它们作为工具定义根本不存在。

## 工具分级(kind)

经 `defineTool` 注册的每个工具必须携带一种 kind,agent 的 policy 声明
它允许执行哪些 kind;`beforeToolCall` 门控对每次调用强制 kind 政策。
模型幻觉出的未知工具名由 pi-agent-core 在门控之前拒绝;门控对"在册"
的复查是一道廉价的不变量(纵深防御):

- **`read-only`** —— 不产生任何状态改变:查询、计算、向用户追问都归此档。
- **`write-intent`** —— 产生效果,但只能以 proposal 形式;效果仅在用户
  确认后发生。将来发通知等外部动作与数据库写入同归此档。

今天唯一的生产 agent(ledger 提取)允许两种 kind;门控的真正用武之地
在下一个 agent——聊天 agent,它将只允许 read-only。`costly`
kind(联网搜索、生图)已有预案,待有域需要时再引入。

## 结构

- 两个并列层,互不包含:`infrastructure/model/` 是 AI 运行时(agent 循环、
  单发客户端、模型目录、错误与类型契约),`infrastructure/actions-kernel/`
  是提案确认状态机。各文件角色见文件头注释。两个非显然决策:单发 `AiClient` 保留"宽容解析+
  一次重试"的 JSON 协议,且当前没有生产调用方(chat 域的意图分类是其
  预期的首个消费者);提案确认内核采用单飞(single-flight:并发确认与
  过期清扫任务合并为同一次执行),各域在 commit 时传入自己的执行器。
- 提示词、工具与 schema 归各域:ledger 的草稿 schema 以 Zod 只定义
  一次,同时是面向模型的工具契约与服务端的形状门控;validation.ts 仍是
  语义信任边界。
- 版本:pi-ai / pi-agent-core 在 pnpm catalog
  (pnpm-workspace.yaml)中精确锁定版本——pi-agent-core 精确依赖它们,
  用 `^` 会装出第二份 pi-ai、类型跨版本分叉。

## 失败处理

纠错由 agent 循环承载(错误工具结果 + 轮数上限);超轮未收敛老实报
`max-turns-exceeded`(经域映射为 HTTP 502)。供应商鉴权失败映射为
`unconfigured`(501);其余传输类失败映射为 `request-failed`/`timeout`。

## 配置

- `TOBY_AI_MODEL` 是 pi-ai 的 "provider/model" 组合(如 `zai/glm-4.7`);
  留空则 AI 路径整体不可用(501)。组合在装配时对照 pi-ai 内置模型列表
  解析,未知组合启动即报错。
- 供应商密钥放在 pi-ai 的 per-provider 环境变量(如 `DEEPSEEK_API_KEY`)或其
  凭据库——不进 Toby 自己的变量,更不进仓库。

## 测试

自动化测试永不调用真实模型:pi-ai 的 `fauxProvider` 可脚本化应答
(含错误 stopReason 与慢速流),agent 工厂接受注入的模型集合/流函数。
真实模型回归单独运行,需显式授权。

---

## 参考

本决策取代原 ai-integration.md —— 它规定了"不使用端点原生工具调用"的
受限 JSON 协议与手写 OpenAI 兼容 fetch 适配器,已于 2026-10-24 退役,
可从 git 历史取回。
