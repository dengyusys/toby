# 记忆域（Memory）

[English](memory.md) | 简体中文

> 目标契约(域未实施):职责、契约、边界与验收;实现以代码与测试为准。
> 关联决策：ADR「server 与 Memory 合并单进程」；域内历史决策（混合检索与情节蒸馏）见文末「决策记录」

## 职责与边界

用户在对话里说「记住我不吃香菜」「别记这条了」，获得一张待确认的记忆提案卡（保存/删除动作清单），核对确认（或亮出 30 秒到点）后写入 `data/memory.db`。

- 入记忆的只有影响书童服务的**长期信息**：偏好、约束、个人事实、重要决定、进行中事项状态（一次性待办归告示板、打卡归日程、日记随笔归手账）。
- 记忆在两个方向被消费：各域提案生成前的**混合检索**注入（按当前话语找相关的少数条目），与书童 `list_memories` 只读工具。
- 每日首次交互时**情节蒸馏**：翻最近的聊天记录提炼新记忆提案，顺手做近重复合并。

**管**：`/api/memories*` 的管理面（列表/直写/软删/上下文）、记忆提案（生成/确认/取消）、混合检索、嵌入写管线、情节蒸馏。

**不管**：日记随笔与一次性事务（各有归宿）；衰减清理与批量删除提案（下一轮）；记忆页搜索框。

## 行为契约

### 数据表

`data/memory.db`（`TOBY_MEMORY_DB` 覆盖），首启自动建库；旧库（含 importance 列）打开即整表迁移为 Schema v2，数据原样保留：

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  memory_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('profile','preference','constraint','decision','project','diary')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,                 -- 保质期：到期查询侧自动过滤
  needs_embedding INTEGER NOT NULL DEFAULT 1,
  last_accessed_at INTEGER,           -- 检索命中记账（遗忘轮依据）
  access_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, scope, memory_key)
);
```

配套：`memory_meta`（键值：嵌入模型/维度、蒸馏水位）、`memories_fts`（FTS5 trigram 全文索引，触发器随主表同步，软删即摘除）、`memories_vec`（vec0 向量虚表，嵌入未配置或扩展加载失败时不建）。**importance 已退役**（决策「记忆混合检索与蒸馏」，见文末）。

### 检索（消费方式）

按查询文本三路召回各取 20 条——向量（语义近似）、字面（FTS5，短于 3 字符降级 LIKE）、新旧（最近更新+访问次数）——RRF 名次融合取前 12 条，约束类活跃记忆保底随行（上限 5 条）；命中行更新访问记账。降级链：嵌入失败/未配置 → 字面+新旧；扩展缺失 → 同前；全部失败 → 纯新旧（行为上限即旧版全量排序）。上下文格式 `- [分类] 键：内容`、3000 字符预算不变。

### 情节蒸馏

距上次超 24h 且水位后有新消息时，当日首次用户消息回复前同步跑：翻水位后 200 条/7 天内聊天记录 → AI 提炼（上限 8 条、只许 upsert）→ 向量近重复合并（≥0.90 复用旧 key + remove 重复；≥0.98 视为已涵盖跳过）→ 记忆提案卡先导呈递。水位在提案生成时推进，**取消的条目不再重复提**；蒸馏失败静默跳过。

### API

均为 JSON（`GET /api/memories/context` 为 text/plain）；错误包络 `{ error: { code, message } }`：

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `GET /api/memories` | `userId?`、`projectId?` | `200 { memories: [{ memory_key, category, content, updated_at }] }`（按更新时间降序，仅活跃未过期，上限 50） |
| `GET /api/memories/context` | `userId?`、`projectId?`、`query?`（可选：带查询词走混合检索，不带为全量清单） | `200 text/plain` 上下文文本 |
| `POST /api/memories` | `{ userId?, action, memoryKey, category?, content?, expiresAt? }` | `200 { status, action, memoryKey }`（直写，管理面不经提案） |
| `DELETE /api/memories` | `userId?`、`memoryKey`、`projectId?` | `200 { status: "removed", memoryKey }`（软删） |
| `POST /api/memories/proposals` | `{ message, userId?, projectId?, messageId? }`（message ≤2000 字符） | `200 { proposal_id, expires_at, reply, actions }`；无可执行动作（没提炼出要保存的、或删除目标不在本轮清单中）`200 { proposal_id: null, reply }`——不出提案卡，reply 由对话域作正文呈显（2026-10-06 修订） |
| `POST /api/memories/proposals/:id/commit` `/cancel` | 只从 URL 取 id | `200 { status, actions }` / `{ status: "canceled" }` |

提案动作（`actions[]` 元素，单轮 ≤5、蒸馏 ≤8）：

```jsonc
{ "action": "upsert", "memoryKey": "小写字母数字点下划线连字符",
  "category": "profile|preference|constraint|decision|project",
  "content": "1-300 字", "expiresAt": 1759276800000 }  // expiresAt 可选，仅时间性事实
{ "action": "remove", "memoryKey": "…" }               // 目标必须在本轮上下文清单中（幻觉防护）。
                                                       // 删除意图由 AI 判定，不设措辞门禁
                                                       // （2026-10-06 用户决策，与告示板「撕掉」
                                                       // 同纪律——确定性防线是目标白名单与提案卡）
```

错误码沿用：`PROPOSAL_NOT_FOUND`(404)、`PROPOSAL_EXPIRED`(410)、`PROPOSAL_CANCELED`(409)、`PROPOSAL_ALREADY_COMMITTED`(409)、`PROPOSAL_COMMIT_FAILED`(422)、`INVALID_REQUEST`(400)、`INVALID_MEMORY_KEY`(400)、`INVALID_INTEGER`(400)、`PAYLOAD_TOO_LARGE`(413)；方法不匹配 405、未知路径 404（server 语义）。

### 嵌入配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `TOBY_EMBEDDING_API_KEY` | —（未配置则嵌入禁用，检索降级，进程照常启动） | 智谱 API key |
| `TOBY_EMBEDDING_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容端点 |
| `TOBY_EMBEDDING_MODEL` | `embedding-3` | 模型名 |
| `TOBY_EMBEDDING_DIMENSIONS` | `1024` | 维度（变更触发全量重嵌） |

真实服务回归：`pnpm run verify:embedding`（管理员手动执行）。

## 边界与安全

- 写入纪律不变：AI 只产出提案内容，落库由 server 确认后执行；蒸馏产物同样过提案核对。
- 敏感内容（密钥/证件等正则命中）不送外部嵌入服务，仅靠字面检索。
- 记忆内容发送智谱做向量化，与对话发送 DeepSeek 同类；删除为软删，可恢复。
- 未决：日程确认后 `onCommitted` 隐式写记忆不经核对（ADR「server 与 Memory 合并单进程」既有行为，是否收紧见「决策记录」未决点）。

## 验收

- 提案流：生成不落库、确认幂等、取消拒提交、过期 410（契约测试锚定）。
- 删除路径：删除意图由 AI 判定、不设措辞门禁（事故原句「把刚记的那条记忆删了吧」为回归用例），确定性防线是目标白名单丢弃未知 key；空动作不出提案卡、reply 作对话正文（2026-10-06）。
- 检索：三路融合与约束保底席、降级链（嵌入失败/无向量表）、访问记账、TTL 过滤、FTS 中文两字降级 LIKE（单测锚定，假嵌入确定性向量）。
- 蒸馏：24h 触发窗、水位推进（取消不重提）、近重复合并、AI remove 丢弃、失败静默（单测锚定）。
- 迁移：v1 库（importance 列）打开即迁 v2，数据保留、FTS 回填、幂等。
- 自动化不调真实 AI；真实嵌入走 `verify:embedding` 手动回归。

## 决策记录

本域历史决策的背景与取舍。只追加、不改写；实施细节以代码与测试为准，完整原文见 Git 历史。

### 2026-10-01 · 记忆混合检索、情节蒸馏与重要度退役

**背景**：记忆域此前"全量抄送"——所有活跃记忆按重要度+新旧取前 50 条、3000 字符封顶注入每次提示词；按长期用量预期（数百到 2000 条）必然失效——绝大多数记忆永远轮不上场，无关记忆持续稀释提示词。同时三类缺位：检索不认"换说法"、聊天记录（情节记忆）与记忆库（语义记忆）互不相通、AI 起的 memoryKey 漂移成近重复条目。
**取舍**："记什么/怎么取"解耦——入库门槛放宽，由按需检索保证上下文纯净；三路召回（向量 sqlite-vec KNN + FTS5 trigram 字面 + 新旧保底）RRF 名次融合取前 12，constraint 类保底席常年随行（约束不挑话题），检索永不抛错阻塞提案；嵌入服务独立配置（智谱 API，未配置整体禁用、降级检索）而非独立向量数据库——千条量级引入新服务进程违背"单进程 + SQLite-only"；情节蒸馏在当日首次交互同步跑而非后台定时——提案 TTL 仅 10 分钟，深夜空转必过期，同步跑以最小复杂度保证"不空转过期、不无人值守写入"；近重复用余弦探针（≥0.90 同一件事、≥0.98 已涵盖）复用旧 key 合并；importance 整体退役（用户决策）——AI 打的 1-5 分跨轮漂移，检索化后排序职责消失，常驻背景由 constraint 类承担（类别判断比绝对打分稳定）。

### 2026-10-06 · 删除意图宽匹配与空动作不出卡

**背景**：用户说「把刚记的那条记忆删了吧」，AI 正确提出了 remove，但删除意图的门禁是逐字关键词列表（忘记/删除记忆/删除这条记忆…）——「记忆删了」的词序一个都不命中，动作被策略层**静默丢弃**；随后提案服务照常建卡，用户看到一张「这句话没有提炼出值得保存的记忆」的空卡，30 秒到点还被自动「确认写入」了一次（对话实测）。
**取舍**：两层修——①门禁改宽匹配正则：「删/抹/清」与「记忆/刚记的」两种词序、动词与名词间隔限 6 字句读截断（「把刚记的那条记忆删了吧」「把刚记的删了」「忘掉刚才记的」都放行；「把这个待办删掉」「记忆里都有什么」不误伤），remove 目标仍须本轮清单见过的 key（幻觉防护不动）；②空动作不再建提案卡：返回 `proposal_id: null` + reply，对话信封把 reply 作正文直接呈现（说明不是追问，不套追问前缀），与 todo 域「指认不出目标不出卡」同纪律；commit 对空动作载荷的无操作成功分支保留为防御。提示词同步补「用户明确要求删除时对对应 memoryKey 提出 remove、找不到就如实说」的规则。被否方案：删掉这层用户意图门禁、只信 AI——门禁是对"AI 幻觉 remove"的第二道确定性防线，宽匹配保住它而不是拆掉它。

### 2026-10-06 · 删除意图撤销措辞门禁（方案一）

**背景**：上一条修订（宽匹配）当日即被用户质疑：删除动作要过一道关键词白名单逐字匹配，是否限制了删除的触发方式？对普世、通用、开源定位的软件，这道门禁该不该存在？经比对开源实践——mem0 的记忆管线由 LLM 输出 ADD/UPDATE/DELETE 事件、Letta/MemGPT 的 agent 用工具自主管理记忆块、LangGraph 对破坏性操作用执行前 interrupt 而非措辞解析——共识是「用户想不想删」是语义判断交给模型，「能不能删这条、删前要不要确认」才是确定性代码的职责，没有项目在用户措辞上做正则门禁；且本仓库告示板「撕掉」（物理删除）与手账删除早已是 AI 判定 + 目标白名单 + 提案卡、无措辞门禁，记忆域是五域中唯一的例外（独立记忆服务合并的遗产）。宽匹配只是降低漏网率，措辞本质不可枚举（「那条不要了」「刚才说的不算」永远在门外）。
**取舍**：用户定案方案一——撤销措辞门禁，删除意图由记忆 AI 判定（提示词规则承担），与告示板「撕掉」完全同纪律；确定性防线保持在执行侧：目标白名单（remove 的 key 必须是本轮清单里见过的，会话层）与提案卡确认（含 30 秒自动写入）。防"AI 漂移提 remove"由四层减为三层（提示词、目标白名单、提案卡），接受该风险——todo 撕掉（更不可恢复的物理删除）早已运行同款风险面，记忆删除为软删（回收站式缓解）。upsert 侧的敏感内容与临时消息过滤不动（拦的是内容与场景，不是删除意图）。被否方案：方案二（含 remove 的提案不参与 30 秒自动写入、必须显式确认）——更接近 LangGraph 式 human-in-the-loop，但与「沉默即认可」的统一写入语义分叉，且要动提案生命周期内核；保留措辞门禁作兜底——与开源实践相悖，且换一种说法就删不掉的缺陷无法根除。
