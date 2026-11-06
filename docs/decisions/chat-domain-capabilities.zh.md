# Chat 通过注册的域能力路由

[English](chat-domain-capabilities.md) | 简体中文

## 为什么

**今天落地一个域,要改 chat 的五个文件,外加 `composition-root.ts` 里一段手写适配。**
具体到加 `schedule`:

- `chat/types.ts`——扩 `ChatIntent` 联合,新增 `ChatScheduleReceipt`;
- `chat/intent.ts`——加枚举项,加一段分类器 prompt;
- `chat/service.ts`——给 `route()` 加分支,删一条 `ON_THE_WAY`,
  加端口依赖;
- `chat/agent.ts`——加三个只读工具、一段规则、一个
  `inspectTargetOf` 分支;
- `composition-root.ts`——手写把 schedule service 适配成端口的代码。

chat 持有域名字的集合,而它应该只持有"可路由域"的形状。

**"一次定满"的意图集合是第一天的取舍;域真正开始落地后,它反转为负担:**

- 每次落地都是一次 chat 契约变更;
- 分类器在宣传并不存在的意图;
- "在路上"提示在向用户承诺还不存在的功能。

## 模型

想接入 chat 路由的域导出一个**能力**——一个对象,由它自己的
service 构建,放在它自己的目录里。组合根收集能力,把注册表交给
`chatPlugin`。chat 认识注册表的形状,不认识其内容。

```ts
// src/chat-capability.ts — 组合根层,纯类型叶子
import type { ToolDefinition } from "./infrastructure/model/agent.ts";

/** 写路径的产物:三者取一;域层面的结果绝不靠 throw 表达
 *  (校验不过是一个 notice,不是一个错误)。 */
export type ChatWriteOutcome =
  | {
      kind: "receipt";
      proposalId: string;
      confirmText: string;
      receipt: Readonly<Record<string, unknown>>;
    } // 不透明透传
  | { kind: "question"; text: string } // 一个澄清追问
  | { kind: "notice"; text: string }; // 诚实的婉拒 / 失败文案

export interface ChatDomainCapability {
  readonly intent: string; // "ledger"
  readonly label: string; // "记账"
  /** 分类器 prompt 的一行,逐字使用:"- ledger(记账):记一笔钱、查账、问花了多少。" */
  readonly intentDescription: string;
  /** 写路径。调用域的 service,与今天完全一样经过 actions kernel
   *  (按分层规则 immediate 或 gated)。 */
  handleWrite(sentence: string): Promise<ChatWriteOutcome>;
  /** none-agent 的只读工具;经共享工厂保持种类门控。 */
  readonly tools: readonly ToolDefinition[];
  /** 拼进 none-agent 规则的片段。 */
  readonly agentRules?: readonly string[];
  /** toolCall → 预览面板 target("ledger:2026-11");undefined = 无 chip。 */
  inspectTarget(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
  ): { target: string; label: string } | undefined;
}
```

里面嵌着的决策,明说:

- **确认文案归域。** `已记入 2 笔,短时间内在卡片上可撤销` 引用的
  是 ledger 自己的 receipt 字段,今天却写在 chat 的 `route()` 里。
  以后它作为 `receipt` 结果里的 `confirmText` 随能力携带,chat 不再
  替域措辞。
- **receipt 对 chat 不透明**——与 chat 对 pi-ai transcript 项的既有
  立场一致:服务端不解释内容,渲染是 webs 的事。chat 原样拷进卡片
  项。
- **`handleWrite` 不得用 throw 表达域结果。** 拒绝(kernel 冲突、
  意外失败)沿现有 catch 路径落为通用"查询出了点问题"notice——
  把现有语义写死下来。

## 各触点的前后对照

| 文件                  | 之前                                                                | 之后                                                                                                                              |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `chat/types.ts`       | `ChatIntent` 联合、`ChatLedgerReceipt`、月/日汇总、`ChatLedgerPort` | 全部删除;`ChatIntent` = `string`,items 不变                                                                                       |
| `chat/intent.ts`      | `INTENTS` 数组、手写 prompt 段落                                    | 枚举与意图行在插件装配时由注册表派生;框架、`none` 行、补全规则不动                                                                |
| `chat/service.ts`     | `route()` if 链、`ON_THE_WAY` 表、端口依赖                          | `route()` 查 `capabilities.get(intent)`;查不到 → none-agent(过期/未注册的 intent 字符串降级为 `none`,绝不 404);`ON_THE_WAY` 删除  |
| `chat/agent.ts`       | 三个 ledger 工具、`inspectTargetOf`、格式化辅助                     | 泛化的 none-agent:工具集 = 注册表工具拼接,规则 = 基础规则 + 各能力片段;ledger 的工具/辅助移入 `domains/ledger/chat-capability.ts` |
| `composition-root.ts` | 手写 `chatLedgerPort` 适配                                          | `capabilities: [ledgerChatCapability(ledgerDomain.service)]`——每域一行                                                            |
| `domains/ledger/`     | 与 chat 无关                                                        | `chat-capability.ts`:写结果、三个工具、`inspectTarget`,全部用 ledger 自己的类型                                                   |

装配时校验,启动即失败:`intent` 重复或 tools 加 rules 为空,在
`chatPlugin` 内、第一条消息之前 throw,而不是等第一句话。

## 契约类型放在哪

`src/chat-capability.ts`,与 `DomainMount` 同层。它只 import
`infrastructure/model/agent.ts` 的类型;各域以 type-only 引用它;
边界测试新增一条规则——它是叶子(不 import 任何域,也不 import
chat)。红线因此保全:

1. 域之间依旧互不 import,并且从现在起也不 import chat——能力是
   结构匹配的形状;域的 `chat-capability.ts` 针对叶子契约和它
   自己的 service 编译。
2. infrastructure 保持业务无关——`intentDescription` 是业务词汇,
   所以契约放组合层,不进 `infrastructure/`。
3. 跨域装配仍只发生在 `composition-root.ts`,收缩为注册表列表。

## 契约变更(`packages/contract`、两个 web)

- `ChatIntent` 在线路上变为 `string`;合法集合是服务端内部、由
  注册表派生的。分类器的 zod 枚举在运行时由已注册 id 构建。
- `ProposalCardItem.domain` 变为 `string`;`chat-client.ts` 里的
  `receipt` 变为不透明(`unknown`)——该文件从此**不再随域落地
  而改动**。各域的 receipt 视图类型留在自己的 client 文件里
  (`ledger-client.ts` 保留 `LedgerReceiptView`)。
- 各 web 把 `item.receipt as LedgerReceiptView` 的强转换成按域 id
  注册的卡片渲染器;ledger 渲染器用 `ledger-client` 的类型收窄
  receipt。未知域 id 渲染一个中性的"不支持的卡片"壳——旧客户端
  对上新服务器时降级而非崩溃。
- `ON_THE_WAY` 消失:分类器只认识已注册的意图。memory/notes/todo/
  schedule 在落地前不再被宣传——一个诚实的 UX 变化,有意为之。

## 不变的部分

- actions kernel 仍是唯一写路径;`handleWrite` → 域 service →
  kernel,分层语义与撤销窗口不动。
- 闭合的 item 联合保持闭合——能力产出 `ChatWriteOutcome` 形状,
  映射到既有 item 类型;新增 item 类型仍是 chat 的显式决策。
- 零翻译回放、`card_outcome`/`reportOutcome`、限流、各域线路错误
  码(各域自己的 `errors.ts`)、trace bus 接线全部不动。

## 已知边界

注册表消除机械复杂度,不消除分类难度:八个意图挤一个 prompt 照样
可能混淆模型。解法(分级分类、每域分类器)若实际使用需要,另有
自己的 ADR——不提前建。

## 落地

一波完成,ledger 作为参考能力(它是唯一落地的被路由域——迁移面
最小):

1. `src/chat-capability.ts` + 边界测试叶子规则;
2. chat 五个文件改为注册表驱动,删除 `ChatLedgerPort`;
3. `domains/ledger/chat-capability.ts`(写结果、工具、inspect)取代
   `composition-root.ts` 适配;
4. contract:`ChatIntent`/`ProposalCardItem` 开放;两个 web 换成
   渲染器注册表;
5. 测试:ledger 能力在 ledger 域内测;chat 测试挂假能力而非假端口;
   分类器测试断言派生的枚举与 prompt 行;
6. `docs/features/chat.md` 改写:"加意图是契约变更"变为"加意图是
   一次域注册"。

schedule 落地时采用该模式。
