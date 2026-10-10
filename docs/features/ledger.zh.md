# 记账域（Ledger）

[English](ledger.md) | 简体中文

> 目标契约(域未实施):职责、契约、边界与验收;实现以代码与测试为准。
> 关联决策：域内历史决策（建域与存储选型）见文末「决策记录」

## 职责与边界

- 查看账目：Web（侧栏记账面板与全屏查看层）按月历查看任意月份的每日收支小计与月度汇总。
- 记账：通过对话页一句话（含多笔）生成提案，核对后确认写入 `data/ledger.db`。
- 共存与精度：历史导入数据与新增记录在同一份账目中共存；金额全程以**整数分**存储，不引入浮点误差。

**管**：`/api/ledger/*` 的月份、月度交易与分类汇总查询，一句话 AI 提案与结构化提案，确认/取消与整批原子写入。

**不管**：记录的修改与删除；预算、报表图表、多账户体系、多币种；历史导入数据迁移（已完成，域只承接既有库）。

## 行为契约

### 数据表

`data/ledger.db`（`TOBY_LEDGER_DB` 覆盖），全新建库 DDL 与导入库逐字一致：

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY,
  date         TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  account      TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  source_line  INTEGER NOT NULL
);
```

### API

均为 JSON；启用认证时需会话 Cookie；错误包络沿用 server 惯例 `{ error: { code, message } }`：

| 方法与路径 | 请求 | 成功响应 | 失败 |
| --- | --- | --- | --- |
| `GET /api/ledger/months` | — | `200 { "months": ["2026-09", …] }` 倒序 | — |
| `GET /api/ledger/transactions?month=YYYY-MM` | month 查询参数 | `200 { month, transactions: LedgerTransaction[], summary: { expense_cents, income_cents, by_category: [{ category, type, total_cents, count }] } }` | `400` month 非法 |
| `POST /api/ledger/proposals` | `{ message }`（一句话，AI 分析，可含多笔；优先）或 `{ transaction: { date, type, category, account?, amount, note? } }`（确定性单笔） | `200 { proposal_id, expires_at, transactions: 归一化字段数组（1–10 笔） }`；AI 不确定时 `200 { proposal_id: null, question }` | `400` 字段校验失败；`422 LEDGER_TOO_MANY` 超过 10 笔；AI 故障 `503 AI_UNAVAILABLE`/`504 AI_TIMEOUT`/`502 AI_BAD_OUTPUT` |
| `POST /api/ledger/proposals/:id/commit` | — | `200 { status: "committed", transactions }`（整批原子落库，与提案等长） | `404` 不存在 / `410` 过期 / `409` 已取消 / 已提交幂等返回 |
| `POST /api/ledger/proposals/:id/cancel` | — | `200 { status: "canceled" }` | `404` / `410` / `409` 已提交 |

### 关键规则

- 一句话里含多笔收支时全部提取：一笔提案携带全部交易（1–10 笔），确认一次、整批原子写入，任一笔失败整体回滚。
- 提案 TTL 10 分钟，与日程/记忆一致；commit 幂等（已提交返回首次落库结果，不产生重复行）。提案亮出 30 秒未取消即由服务端自动写入（2026-10-05 用户决策），与人工确认同一条 commit 路径。
- **用户路径**：对话页输入一句话 → 意图路由进入记账路径 → AI 能给出完整字段则返回待确认提案（不写入），不确定则返回追问（`{proposal_id: null, question}`），用户补充后重试 → 消息内核对逐笔字段行 → 确认或取消。
- 结构化字段（`{transaction}`）是同一提案端点的确定性路径，供测试与程序化调用。
- 确认成功后侧栏记账面板重新拉取数据，与日程确认后刷新月历同一节奏。

### 异常与边界

- **金额精度**：`"19.99"` 按字符串拆位解析为 `1999` 分；`19.9`、`5`、`0` 合法（归一 `"19.90"`、`"5.00"`、`0` 分），`19.999`、`-3`、`1e3`、`０.５`（全角）拒绝并提示"金额必须是最多两位小数的非负数字"。
- **日期**：`2026-02-30`、`2026-13-01`、`2026-2-3`（未补零）拒绝；`2024-02-29`（闰年）合法；允许记录任意过去或未来日期（补记账场景）。
- **提案过期**：TTL 过后 commit/cancel 返回 `410 PROPOSAL_EXPIRED`；Web 显示的剩余秒数归零后禁用确认按钮。
- **并发**：写入经 SQLite 同步事务串行化；同一提案不可能被并发 commit 两次落库（内存 store 单进程语义，server 是唯一写入进程）。
- **权限**：所有 `/api/ledger*` 在认证作用域内，未登录由全局 auth guard 返回 401。
- **数据异常**：库不存在或为空库时 `months` 返回空数组、列表为空，Web 显示空态文案；表结构不符时 SQLite 报错冒泡为 500，不静默吞掉。
- **请求体**：非对象/字符串体返回 `400 INVALID_REQUEST`；未知字段忽略。

## 安全边界

- 必须：所有新增写入走"生成提案 → 用户核对 → 使用 URL 中的 `proposal_id` 确认"。
- 禁止：AI 输出直接落库——AI 提取结果视为不可信输入，必须经域内确定性校验与归一化后才生成提案。
- 禁止：记账测试触碰正式 `data/ledger.db`——全部测试使用临时目录建库。

## 验收

- 自动化（已通过，见 `apps/server/test/` 记账域集成测试与根 HTTP 集成测试）：校验归一化（金额/日期/类型/超长类别拒绝且无提案与数据行）、提案生命周期（commit 落库、幂等、取消 409、过期 410）、AI 路径（stub 返回坏金额仍 `400`——AI 输出不豁免确定性校验）、HTTP 契约全端点。
- 浏览器人工验收（录入一笔、月度汇总正确）待用户复核。

## 决策记录

本域历史决策的背景与取舍。只追加、不改写；实施细节以代码与测试为准，完整原文见 Git 历史。

### 2026-09-13 · 记账域作为 server 第四业务域

**背景**：用户从鲨鱼记账 App 导出的历史消费明细已规范化导入本地 SQLite，但数据是"孤岛"——server 不感知、Web 无入口；需要与日程、记忆同构的日常读写入口。
**取舍**：独立业务域而非并入日程/记忆——收支类型、金额分、分类、账户的领域模型与两者完全不同，强行复用会污染两边的字段白名单与校验规则；独立 `ledger.db` 而非并入 schedule.db——日程库受最严格的数据保护约束（校验、备份、SHA-256 流程），记账高频写入且生命周期不同，文件级隔离互不拖累；写入走提案确认制而非直写 CRUD——否则记账成为全应用唯一"无确认写入面"，破坏"先确认再记录"心智，提案层同时是 AI 解析的天然插槽；金额全程整数分、十进制字符串传递——从根上规避浮点求和误差。被否方案：AI 自然语言解析一步到位（v1 无法本地自动化闭环，接口预留）、复用日程提案管道（与日程操作契约深度耦合，改造成本高于新建轻量域）。
