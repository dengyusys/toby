# 对话域（Chat）：统一对话界面

[English](chat.md) | 简体中文

> 现行契约:职责、接口与关键规则;实现细节以代码与测试为准。附件两端点将在后续独立波次落地。

## 职责与边界

全应用唯一的对话框:一句话进来,意图分类后分发——业务意图(日程/记账/记忆/手账/待办)走对应域提案管线,其余交智能体应答。

- **管**:消息与会话持久化(`data/chat.db`)、意图路由、附件、卡片终态记录、预览面板的语境式入口。
- **不管**:各域提案管线本身(只调用、零改动)、外部世界查询(将来可登记新工具)、对话历史的 TTL 清理策略。
- **不变式**:对既有提案端点的路径、动作、状态码、响应结构零改动。

## 核心概念

- 只有一个持续对话:刷新恢复,无会话切换/新建/删除(会话 API 保留用于找回这一个对话)。
- 每条回复是一段有序的项流:pi-ai 形状的消息(user / assistant / toolResult,靠 `toolCallId` 配对)加上 toby 卡项——提案卡、查看跳转、通告;附件引用挂在用户消息上,路由意图作为回合元数据随流返回,前端按顺序渲染这条流。
- 各域浏览能力不回退:PC 由 inspect 链接与推送的预览卡片打开预览面板(对话旁无常驻入口);移动端左侧导航抽屉 + 全屏预览面板,三页分页(手账/对话/告示板常驻)随对应域落地。

一轮的形状——配对靠 `toolCallId`,溯源靠 `sourceToolCallId`:

```text
回合元数据          intent = ledger · excerpt(派生,永不单独成条)
────────────────────────────────────────────────────────────────────
message·user        "记一笔午饭 30 元,再看看这个月餐饮花了多少"(附件引用挂此)
message·assistant   thinking + ToolCall(c1)
message·toolResult  c1 → ¥1,240            ← 按 toolCallId 配对
message·assistant   ToolCall(c2)
message·toolResult  c2 → ¥360              ← 按 toolCallId 配对
message·assistant   text("已生成记账提案…")
proposal_card       proposalId + 快照 · 门控:pending → confirmed/cancelled/expired
                                          · 直写:出生即 confirmed + revertUntil
inspect_link        sourceToolCallId=c1 → 预览面板
inspect_link        sourceToolCallId=c2 → 预览面板
```

## 接口面

除附件上传(multipart,「只收 JSON」的唯一破例)外均为 JSON;错误体沿用 server 惯例。

| 方法与路径                            | 用途                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `POST /api/chat/messages`             | 发一句话,意图路由分发,返回本轮意图与有序项流(限流 20 次/60 秒/IP) |
| `POST /api/chat/attachments`          | 上传附件:图片/文档白名单,大小在端点层硬限                         |
| `GET /api/chat/attachments/:id`       | 取附件原始字节(内容寻址,immutable 缓存)                           |
| `GET /api/chat/sessions`              | 会话列表                                                          |
| `POST /api/chat/sessions`             | 新建会话                                                          |
| `GET /api/chat/sessions/:id/messages` | 分页查消息(limit + before 游标向上翻页)                           |
| `DELETE /api/chat/sessions/:id`       | 删除会话(事务级联删除消息)                                        |
| `POST /api/chat/messages/:id/outcome` | 上报卡片终态(仅展示元数据,不影响业务数据)                         |

## 关键规则

- 意图分类输出意图 + 自足句子:追问碎片折叠后再分发;对上一轮的纠正指令按纠正后的目标域重新分类。
- AI 结构化输出统一走经 schema 校验的通道(Zod 工具参数,或无循环场景的单发 `json()` 入口):不合格输出回喂模型自行修正;最终失败返回诚实重发提示,不 5xx、不静默丢消息。
- `none` 意图交智能体:只读工具、有限轮次、只用真数据不编造,超长列表如实说明截断;失败回退固定文案。
- 写入分级(见 [write-confirmation-tiers](../decisions/write-confirmation-tiers.zh.md)):追加类操作立即落库——卡出生即 confirmed,带撤回窗口;破坏类操作保留三触发——显式确认按钮、下一条消息默许(待确认提案旧到新逐条 commit)、亮出 30 秒服务端自动写入——取消是唯一拒绝路径。
- 用户消息先落库再调 AI;AI 故障时本轮不产生回复与提案,客户端保留输入可重试。
- 项类型是经 `@toby/contract` 两端共享的封闭 union——pi-ai 消息类别加上 `proposal_card`、`inspect_link`、`notice`;新增类型是显式决策。消息条目逐字复用 pi-ai 的字段名——零翻译回放。会话列表的预览节选(`excerpt`)是派生、可重算的字段,永不属于 transcript 本体。
- 状态长在它的消费者读它的地方。transcript 的状态是结构性的——没有配对 toolResult 的工具调用就是诚实的"进行中":没有孤儿,无需清理。卡片的状态是字段性的——`proposal_card` 携带 kernel 的状态机(`pending → confirmed / cancelled / expired`;直写级的卡出生即 confirmed,带 `revertUntil`)。派生状态(`excerpt`、记录在案的终态)由服务端重算或写入,从不单独成条。
- 恢复的历史里卡片以记录的终态渲染，过往提案不再带确认按钮。
- 附件两段式:先传拿 id、随消息引用;带附件的消息不进意图分类,直接交智能体;附件一次性,孤儿 24 小时清理;白名单外 415、超限 413。
- 智能体实际调用的只读工具确定性映射为查看跳转(inspect link),点击直达对应预览面板;AI 不参与标注。
- chat 域不写任何业务库,只写自己的 chat.db;跨域调用全部经端口注入,域文件不 import 其他业务域。
