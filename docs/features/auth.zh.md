# 认证域（Auth）：公网单用户访问

[English](auth.md) | 简体中文

> 目标契约(域未实施):职责、契约、边界与验收;实现以代码与测试为准。

## 职责与边界

为一个用户提供 Web 登录。未登录的人不能读取日程、使用 Memory、生成提案或确认写入。HTTPS 只负责加密传输，不能代替登录认证；公网入口保持启用认证。

管：server 登录、退出、查询当前会话和统一认证保护；Web 登录页、保持登录、退出和会话失效处理；密码哈希、会话过期与吊销、登录限流、脱敏日志。

不管：多用户、注册、找回密码、短信、OAuth、管理员后台或公共分享。

## 行为契约

### 接口

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/v1/auth/login` | 登录并建立 Web 会话 |
| `POST /api/v1/auth/logout` | 吊销当前会话 |
| `GET /api/v1/auth/session` | 查询当前会话 |

认证由环境变量显式启用；未配置密码哈希时认证不启用，server 保持本地开发行为：

| 配置名 | 默认值 | 说明 |
| --- | --- | --- |
| `TOBY_AUTH_PASSWORD_HASH` | 无 | scrypt 密码哈希，配置后启用认证；用 `pnpm run auth:hash-password` 生成 |
| `TOBY_AUTH_SESSION_TTL_MS` | `604800000`（7 天） | 会话有效期；过期后必须重新登录 |
| `TOBY_AUTH_COOKIE_SECURE` | `false` | 会话 Cookie 的 `Secure` 属性；本地 HTTP 必须为 `false`，公网 HTTPS 部署必须为 `true` |
| `TOBY_AUTH_LOGIN_RATE_LIMIT` | `5` | 登录限流次数（按客户端 IP，固定窗口） |
| `TOBY_AUTH_LOGIN_RATE_WINDOW_MS` | `60000` | 登录限流窗口 |

### 请求与响应

包含请求体的认证请求使用 JSON，请求体上限 16 KiB。错误响应统一为 `{ "error": { "code", "message" } }`。

**`POST /api/v1/auth/login`**

- 请求体：`{ "password": "..." }`
- 成功 `200`：`{ "session": { "expires_at": "<ISO 8601>" } }`，并设置 `Set-Cookie`。
- `400` `INVALID_REQUEST`：缺少密码或请求体不是合法 JSON。
- `401` `INVALID_CREDENTIALS`：密码错误（单用户无用户名）。
- `429` `RATE_LIMITED`：超过登录限流，带 `Retry-After` 响应头。

**`POST /api/v1/auth/logout`**

- 客户端当前发送空 JSON 对象 `{}`；服务端不读取或校验 logout 请求体，该写法是客户端约定而非强制契约。
- 成功 `200`：`{ "ok": true }`，吊销当前会话并清除 Cookie；未登录时也幂等返回成功。

**`GET /api/v1/auth/session`**

- 成功 `200`：`{ "enabled": true, "session": { "expires_at": "<ISO 8601>" } }`。
- 未登录 `401`：`{ "error": { "code": "UNAUTHORIZED", "message": "请先登录" } }`。
- 认证未启用时返回 `200`：`{ "enabled": false }`，Web 据此视为无需登录。

### 会话存储与保护范围

- 会话令牌为 256 位随机值（base64url），服务端只保存 SHA-256 摘要与到期时间；内存存储，进程重启后全部失效。
- Cookie 名为 `toby_session`，属性为 `HttpOnly; SameSite=Strict; Path=/; Max-Age=<有效期>`，公网部署时按配置追加 `Secure`。
- 认证启用后，除以下豁免外，所有页面与 `/api/*` 都必须携带有效会话 Cookie，否则返回 `401`：
  - 认证接口自身（login/logout/session；logout 未登录时也幂等成功）。
  - 静态页面资源（只承载登录界面 UI，不含业务数据）：PC 端 `/`、`/favicon.svg`、`/assets/*`、`/js/*`、`/css/*`；移动端 `/m`、`/m/`、`/m/favicon.svg`、`/m/assets|js|css/*`（ADR「Web 拆分双应用」）。
- 未登录访问受保护路径统一返回 `{ "error": { "code": "UNAUTHORIZED", "message": "请先登录" } }`；Web 收到 `401` 后回到登录页，提案确认请求不自动重试。

## 安全边界

- 必须：所有业务页面和业务 API 默认要求登录；Web 使用 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie，客户端 JavaScript 不读取或保存令牌。
- 禁止：服务端保存明文密码或令牌；密码、令牌和密钥进入源码、Git、公开配置或日志。
- 禁止：`8629` 和开发态端口（`8630`/`8631`）直接向公网开放。
- 不变：既有提案规则不受认证影响——只有用户使用 `proposal_id` 明确确认后才能写入。

## 验收


- 未验证：手机蜂窝网络下的复测（非阻断）。

自动化覆盖见 `apps/server/test/`（未登录、错误密码、退出、过期、吊销场景）。
