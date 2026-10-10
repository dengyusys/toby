# 书库域（Library）

[English](library.md) | 简体中文

> 目标契约(域未实施):职责、契约、边界与验收;实现以代码与测试为准。
> 关联决策：文档抽取运行时见 ADR《文档处理引入 Python 运行时》；提案状态机与 30 秒自动写入见共享内核与[对话域功能文档](chat.md)

## 职责与边界

用户在 PC 端书库页上传一本小说（txt / md / docx / pdf / epub / mobi），server 经 Python 公共包拆成章节，生成一张「导入《书名》共 N 章」的待确认提案卡；确认（或亮出 30 秒到点自动写入）后整书落入 `data/library/`——一本书一个目录，manifest.json + 各章 Markdown。之后可浏览书单与章节正文。

- 这是小说助眠功能四期规划的第二期（2026-10-05 用户定案）：① Python 文档内核与 chat 切换 → **② 书库域（本期）** → ③ 助眠改写（AI 管线） → ④ 语音（豆包 TTS，基础设施定位）。
- 拆章在 Python 侧完成（epub 按 spine 文件边界优先、正则只做文件内细分；txt 走章节标题正则；识别不到结构时整书作单章「全文」——导入永远可行，切分质量在提案卡与章节目录里如实可见）。
- 上传只产生提案，不落盘；确认前一个字节不进 `data/library/`。
- 阅读在 PC 端书库页（章节目录 + 正文）；移动端本期不设入口（双端分工：上传导入属复杂操作归 PC；移动浏览与播放随后续期）。

**管**：`/api/v1/library*` 的上传拆章提案、确认/取消、书单/书目/章节只读；`data/library/` 目录的写入与读取；`TOBY_LIBRARY_DIR` 路径配置。

**不管**：删书与改书（后续按需评估）；助眠改写（第三期）；语音（第四期）；对话意图路由不接入书库（导入是文件上传流程，不是一句话事务）。

## 行为契约

### 存储

`data/library/`（`TOBY_LIBRARY_DIR` 覆盖），一本书一个目录：

```text
data/library/lib_<24hex>/
├─ manifest.json   # id、title、source_name、format、created_at、
│                  # char_count、chapters[{index, file, title, chars}]
└─ raw/0001.md…    # 各章正文（# 标题行 + 正文，自含可读）
```

- 导入原子性：先写 `lib_<id>.staging/` 全量内容再 rename 落位——中断不会留半本书；读取以 manifest.json 为唯一有效性依据。
- 书 id 只认 `lib_` + 24 位十六进制，路径拼接前校验（不吃路径穿越）。
- 章节文件名 `0001.md` 起步四位零填充。

### 端点

| 方法与路径 | 请求 | 响应 | 错误 |
| --- | --- | --- | --- |
| `POST /api/v1/library/books` | multipart/form-data 单文件（txt/md/docx/pdf/epub/mobi ≤100MB） | `200 { proposal_id, expires_at, reply, book: { title, source_name, format, chapter_count, char_count }, preview: [前 8 章名] }`（Python 拆章后的导入提案，不落盘） | `400 INVALID_REQUEST`（缺文件）；`415 UNSUPPORTED_MEDIA_TYPE`（白名单外/非 multipart）；`413 PAYLOAD_TOO_LARGE`；`422 BOOK_UNREADABLE`（无文字层/损坏/DRM/解释器缺失）、`TOO_MANY_CHAPTERS`（>3000 章） |
| `POST /api/v1/library/proposals/{id}/commit` | 空请求体（只走 URL） | `200 { status: "committed", id: 书 id }`（幂等） | `404/410/409`（不存在/过期/已取消）；`409 PROPOSAL_ALREADY_COMMITTED` 取消时 |
| `POST /api/v1/library/proposals/{id}/cancel` | 空请求体 | `200 { status: "canceled" }` | 同上 |
| `GET /api/v1/library/books` | — | `200 { books: [{ id, title, source_name, format, chapter_count, char_count, created_at }] }`（导入时间升序） | — |
| `GET /api/v1/library/books/{id}` | — | `200 { book: { …书单字段, chapters: [{ index, title, chars }] } }` | `404 BOOK_NOT_FOUND` |
| `GET /api/v1/library/books/{id}/chapters/{index}` | index 1 起 | `200 { chapter: { index, title, text } }`（text 为去标题行的正文） | `404 BOOK_NOT_FOUND / CHAPTER_NOT_FOUND` |

- 提案生命周期与其他写入域同款（内存提案、10 分钟 TTL、亮出 30 秒未取消自动写入、取消是唯一拒绝方式）；确认/取消只交 `proposal_id`，客户端不提交章节内容或文件路径。
- 书名优先级：epub 的 dc:title → 上传文件名去扩展名。
- 拆章超时给到 60 秒（比 chat 附件的 30 秒宽：整本书解析偶发接近半分钟）；失败统一 `BOOK_UNREADABLE` 如实报告，不上传半成品。

## 安全边界

- 必须：只有书库域写 `data/library/`；上传 → 拆章 → 提案 → 确认全程不绕过提案流（铁律「一切新增走提案」对文件域同样成立）。
- 必须：`POST /api/v1/library/books` 是 multipart 破例端点之一（与附件上传同源，ADR 021 先例）；提案确认/取消请求体为空。
- 禁止：客户端提交书 id 以外的存储路径；拆章子进程只收上传字节落下的临时文件路径（spawn 数组参数、无 shell、只读、无网络，ADR《文档处理引入 Python 运行时》）。
- 隐私：书库内容属个人数据，落 `data/library/`（Git 忽略）；拆章在本地进程完成，本域不向 AI 供应商发送任何内容（改写在第三期、届时单独评估外发边界）。

## 验收

- 自动化（已通过，`apps/server/test/library-*.test.ts`）：存储原子落位/书单/章节读取与标题行剥离/路径穿越拒绝；HTTP 全链路经真实 Python 子进程（上传拆章 → 提案 → 确认 → 书单/书目/章节只读、幂等提交、坏文件 422、白名单 415、取消不落盘、取消后确认 409、短时限自动写入）；`config.test.ts` 断言 `libraryDir` 分组。全部使用 mkdtemp 临时目录，不碰正式 `data/`。
- 真实样例（2026-10-06）：《历史的尘埃》epub（5.9MB、162 万字）拆出 399 章——标题完整（「序章 追捕〔一〕」「第三十三章 说过不让你死〔完〕」）、单章最长 1.1 万字、无巨型章节；此结论来自 Python `split` 直跑，HTTP 全链路以夹具覆盖。
- 待用户复核：PC 端书库页人工走一遍（上传真书 → 提案卡 → 确认 → 书单 → 章节阅读、30 秒自动写入到点体验）。

## 开放问题

- 删书 / 改书名：本期不做，需要时按「提案确认制」补。
- 章节粒度异常书（如正文里出现伪标题行被多切）：接受现状，第三期改写按章独立处理，粒度偏细无害。

## 决策记录

本域历史决策的背景与取舍。只追加、不改写；实施细节以代码与测试为准，完整原文见 Git 历史。

### 2026-10-06 · 书库域（第二期）

**背景**：小说助眠功能四期规划的第二期——用户要「上传一本小说，拆成章节收好」，为第三期助眠改写与第四期语音备料；格式面（txt/epub/pdf/mobi，后扩 docx/md）与「静态文档处理统一 Python」的第一期决策直接衔接。
**取舍**：拆章放 Python 侧（epub 的 spine 文件边界是结构事实——标题做成图片的书也保得住章节边界，正则只做文件内细分与 txt 主路径；先合并全文再切正则的方案在真书上翻车——22 万字巨型章节，已弃）；一次导入一张提案（复用 proposal-lifecycle 内核，载荷全量随身、确认后纯文件写入——不在提交路径上再跑 Python）；存储沿手账域「非 SQLite 数据域」先例（一本书一目录 + manifest，staging rename 原子落位）；上传入口只开 PC 端（移动端不承载复杂操作，双端分工）；对话意图不接入（文件上传不是一句话事务，硬塞意图路由只会把提案卡放进不适合展示它的消息流）。被否方案：导入直写不走提案（违反铁律）、章节数据入库 SQLite（章节是文件态资产，md 自含可读、第三期改写产物平级落位更自然）、上传时同步落盘再回滚（取消语义复杂且留垃圾）。
