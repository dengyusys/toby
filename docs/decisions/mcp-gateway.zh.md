# MCP 网关:多一个客户端,同一套规矩

[English](mcp-gateway.md) | 简体中文

Toby 成为 MCP(Model Context Protocol)服务器:外部 agent——Claude Desktop、Cursor、pi agent、自建应用——通过标准协议接入,按 Toby 自己的规矩操作 Toby。

## 为什么

- **一个协议,替代逐客户端的封装。** 任何 MCP 客户端都能驱动 Toby;Toby 不为任何客户端单独写集成。
- **架构本来就长成了这个形状。** 工具带 schema 与安全分类注册,每次写入都过 actions kernel,信任边界是把每个调用方都当不可信输入的确定性服务端校验。网关只是给这套机器多开一个门,不授予任何新能力:"说一句话,得到一个被确认的动作",不因说话的客户端不同而改变。
- **一个进程。** 端点挂在现有 Fastify 服务器上;没有第二个部署,没有第二个数据库句柄。

## 模型

1. **传输与鉴权。** Streamable HTTP,挂在单进程服务器的 `/mcp`(`@modelcontextprotocol/sdk`)。静态 bearer token(`TOBY_MCP_TOKEN`);未配置则路由不挂载——是不可用,不是坏掉——与 `TOBY_AI_MODEL` 的"未配置即不可用"同一惯例。路由刻意不放在 `/api` 下(MCP 客户端没有浏览器 session),也不走 public 旁路:缺 token 或错 token 一律 401。规范对 HTTP 传输推荐的 OAuth 2.1 暂缓——对单用户自托管部署不成比例。
2. **写:结构化工具,对面的模型自己填表。** 账本的 draft schema(本就是 Zod、本就为 pi 转成 JSON Schema 形状)即 MCP 工具契约;调用绑定 HTTP 路由已有的结构化入口(`entry` → `normalizeEntry` → kernel → 出生即确认的凭据,带 `revert_until`)。不消耗任何 Toby AI run;参数不合法以 tool error 返回,纠错循环在对面的模型里跑——与 pi 内部的弹回重试是同一个循环,只是执行者换了人。句子通道(`handleWrite`)刻意不暴露:每次写都烧一次 Toby AI run,还要把追问循环拖进两个 agent 之间。
3. **读:策展白名单,不做自动暴露。** 第一版暴露账本三个查询与 system info。每个暴露出去的 schema 都是公开的、带版本的契约;域按明列加入,新域落地不等于自动对全世界可见。
4. **确认语义原样继承。** 直写级出生即确认,带撤回窗口;门控级保留 30 秒默许——不加按来源的冻结标志。允许写已经把 token 持有者定价为用户本人,"沉默即通过"在各道门之间保持一致。账本今天没有门控操作;第一个带门控操作的域接入 MCP 之前,重开这一条。
5. **不提供 confirm、cancel、revert 工具——对任何调用方都不提供。** 协议无法证明远端坐着的是人,所以每个 MCP 客户端都按 agent 对待,红线不松口:agent 永不替用户确认,也永不替用户撤回。写工具的结果携带凭据(proposal_id、确认文案、revert_until),让对面能在自己的对话里转述卡片;用户的手始终在 Toby 的 Web 界面上。
6. **禁止能力保持"不存在"。** 网关只做注册表到 MCP 工具的映射;没有 shell、文件、数据库工具出现,因为没有可映射的东西。安全分类仍是内部 agent 的概念——对 MCP 调用方,白名单即策略,kernel 即门。

## 位置

两层,镜像 AI 运行时的拆法:`infrastructure/mcp/` 放协议胶水(SDK 接线、token 校验、工具到 MCP 的 schema 映射),不 import 任何域;工具集接口在 composition root 层按结构满足,与 [chat-domain-capabilities.md](chat-domain-capabilities.zh.md) 给 chat 的接线方式一致。边界测试照常盯守。

## 刻意不进第一版的

- **句子通道**——等真出现"没有自己模型"的调用方再开。
- **门控冻结标志**——第一个带门控操作的域接入 MCP 前重开(见"模型"第 4 条)。
- **Elicitation**——MCP 的 server→client 用户输入请求能把确认渲染到客户端自己的界面,但它验证不了远端是否有人,且客户端支持是可选项。
- **OAuth 2.1**——服务器一旦暴露到个人机器之外再重开。

## 测试

与所有其他部分同一待遇:`app.inject` 驱动挂载的端点,token 是脚本化的;自动化测试不碰真实 MCP 客户端,不碰真实 AI。真实客户端冒烟(Claude Desktop 或 pi agent)是显式授权的手工步骤,结果单独汇报。

## 参考

在两个 Web 应用之外加第二类客户端门。各道门共享的规矩:[actions-kernel.md](actions-kernel.zh.md)(写入门)、[write-confirmation-tiers.md](write-confirmation-tiers.zh.md)(MCP 写入继承的分级)、[ai-pi-runtime.md](ai-pi-runtime.zh.md)(信任边界与工具分类)。端点契约随实现落地于 `docs/features/`。
