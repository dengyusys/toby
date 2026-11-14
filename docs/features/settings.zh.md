# Settings 域：运行时可配置的 AI

[English](settings.md) | 简体中文

> 已落地的契约；实现细节在代码与测试中。决策记录见
> docs/decisions/ai-runtime-settings.md。

## 职责与边界

settings 域拥有运行时可编辑的 AI 配置：用哪个模型应答、各供应商的
API key——持久化在它自己的按域数据库（`data/settings.db`），在网页
设置页（PC 与移动端）编辑，下一次 AI 请求即生效。

- **拥有**：`/api/settings/ai`（读/写）与 `/api/settings/ai/catalog`；
  `settings` 与 `provider_credentials` 两张表；已存凭证的掩码视图；
  AI 客户端与 agent 工厂消费的运行时配置解析器。
- **不拥有**：模型传输或目录内容（pi-ai 内置目录，共享实例）、AI
  请求路径本身、或其他任何域的配置。

## 核心概念

- **有效模型**：数据库行 → `TOBY_AI_MODEL` → 无（处处未设置 = AI
  路径保持 501）。视图报告 `source`：`"db"`、`"env"` 或 `null`。
  请求超时刻意不是设置项——`TOBY_AI_TIMEOUT_MS`（默认 30 秒）仍是
  唯一的运维旋钮。
- **凭证就是 pi-ai 凭证**：`provider_credentials` 表存 pi-ai 的
  `Credential` JSON（v1：`{"type":"api_key","key":…}`），并经 pi-ai
  自身的 `CredentialStore` 端口暴露——已存储的 key 优先于该供应商
  的环境变量，未存储时环境变量兜底。key 明文落库——姿态与取舍
  记录在 ADR 中。
- **只有掩码预览**：已存储的 key 永不完整返回；视图只带 `maskedKey`
  （前 3 位 + `…` + 后 4 位；≤ 8 位全部掩码），设置页的密码输入框
  永不回显。
- **一次事务性写入**：整个 PUT——设置项的 upsert/删除与凭证的
  upsert/删除——在单事务内落地，要么全部生效要么全不生效。
- **测试而非猜测**：`POST /test` 用一次真实的迷你模型调用探测
  将生效的配置——请求体里的凭证仅内存生效（未保存的 key 也能
  测），不落任何库；探测结果是 200 携带的数据，绝不是 HTTP 错误。

## 接口

所有路由默认在会话守卫之后（无 public 路由）。错误使用服务器统一
错误体，错误码如下：

| 错误码                        | 状态码 | 含义                                |
| ----------------------------- | ------ | ----------------------------------- |
| `SETTINGS_INVALID_MODEL`      | 400    | model 不是 `provider/model` 组合    |
| `SETTINGS_UNKNOWN_PROVIDER`   | 400    | 凭证供应商不在目录中                |
| `SETTINGS_INVALID_CREDENTIAL` | 400    | 空 key，或一条凭证同时 set 与 clear |
| `SETTINGS_BODY_INVALID`       | 400    | 请求体形状被拒（含未知字段）        |

| 方法与路径                     | 用途                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/settings/ai`         | 有效视图：`model`（`{value, source}`）、`providers`（仅已配置项：`{id, source: "stored"\|"env", maskedKey}`）                                                                                             |
| `PUT /api/settings/ai`         | 请求体 `{model?: string\|null, credentials?: [{provider, apiKey?, clear?}]}`；省略 = 不变，`null`/`clear` 删除（环境变量兜底回归）；应答为新的有效视图                                                    |
| `GET /api/settings/ai/catalog` | pi-ai 内置目录按供应商分组：`{providers: [{id, models: […]]}]}`                                                                                                                                           |
| `POST /api/settings/ai/test`   | 用与 PUT 同形的请求体探测保存后将生效的配置；不落库。恒为 200，应答 `{stage, model, latencyMs, reply, message}`——`stage`：`ok` / `unconfigured` / `invalid-model` / `auth` / `timeout` / `request-failed` |

## 关键规则

- 运行时生效是精确的：AI 客户端与 agent 工厂在每次请求重新解析
  有效配置（两次 SQLite 点查——无缓存、无重启）；模型变更作用于
  下一次调用。
- 目录中已无法解析的模型行在请求时降级为类型化 AI 错误，绝不是
  启动失败。
- 任何地方都没配模型时，所有 AI 路径保持与仅环境变量时代相同的
  501（`AI_UNAVAILABLE` / `unconfigured`）；未配置文案先指向设置页，
  再指向环境变量。
- 服务 `GET …/catalog` 的目录实例就是运行时流经的同一 pi-ai
  集合——下拉列表不会偏离服务器实际可调用的范围。
- PC 与移动端均有设置页（各自 `/settings`）；API 与客户端无关，
  契约在 `@toby/contract`（`createSettingsClient`）。
