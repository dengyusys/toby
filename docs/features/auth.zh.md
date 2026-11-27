# 认证域（Auth）：公网单用户访问

[English](auth.md) | 简体中文

> 职责、接口与关键规则;实现细节以代码与测试为准。决策记录见 docs/decisions/first-run-registration.zh.md 与 docs/decisions/access-tokens.zh.md。

## 职责与边界

为一个用户提供 Web 登录,并为这个用户自己的程序提供访问令牌。没有会话也没有令牌的人,不能读取日程、使用记忆、写入任何东西。HTTPS 只负责加密传输,不能代替登录。

- **管**:首次注册、登录/退出/会话查询、修改密码、访问令牌、统一认证保护、密码哈希、会话过期与吊销。
- **不管**:多用户、开放注册、找回密码、短信、OAuth、管理员后台、公共分享、跨域。

## 核心概念

- 登录始终开启,没有免登录模式。密码在首次启动的注册页面上设置一次,它的 scrypt 哈希存在认证数据库里(`data/auth.db`),不进环境变量。
- 注册只有一次,而且限时:只在还没有密码、且服务端启动后 10 分钟内可用。一直没人注册的服务器是关闭的,不是敞开的 —— 重启会重新打开窗口。
- 会话令牌为高熵随机值,服务端只存 SHA-256 摘要与到期时间;内存存储,进程重启全部失效,密码不受影响。
- Cookie:HttpOnly、SameSite=Strict,公网部署追加 Secure;客户端 JavaScript 不读取令牌。
- 会话有效期与 Cookie 安全属性由 `TOBY_AUTH_*` 环境变量配置(见 docs/operations/local-dev.zh.md)。
- 访问令牌(access token)是所有者的第二种凭证:一个 bearer 密钥,给所有者自己的程序用 —— 自建页面、脚本、智能体 —— 调用自带 Web 应用调用的同一组 `/api` 路由。它代表所有者,从来不是另一个用户。
- 两个档位:`read` 调用所有 GET;`write` 包含 `read` 和其余所有方法。路由可以用 `config.scope` 另作声明,也可以用 `config.sessionOnly` 完全拒绝令牌。
- 服务端只存令牌的 SHA-256 摘要和末四位(`data/auth.db`);明文只在创建时返回一次。它放在 `Authorization: Bearer <token>` 里传输,绝不进 URL —— 查询串会明文进日志。
- 令牌默认永不过期,除非创建时给了过期时间;过期的令牌和被撤销的一样返回 401。修改密码不动令牌 —— 令牌逐把撤销。

## 接口面

均为 JSON;错误体沿用 server 惯例。

| 方法与路径                    | 用途                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`     | 首次注册:设置密码并建立会话;请求体 `{ password }`(任意非空密码)                                                                        |
| `POST /api/auth/login`        | 登录建立会话;密码错 401(注册之前,任何密码都是错的)                                                                                     |
| `PUT /api/auth/password`      | 仅会话。修改密码;请求体 `{ current_password, new_password }`(新密码为任意非空密码,且不能与当前密码相同);所有会话随之失效               |
| `POST /api/auth/logout`       | 吊销会话;未登录也幂等成功                                                                                                              |
| `GET /api/auth/session`       | 查询部署状态:`unregistered`、`unauthenticated` 或 `authenticated`(带 `expires_at`)                                                     |
| `GET /api/auth/tokens`        | 仅会话。`{ tokens: [{ id, name, scopes, last_four, created_at, last_used_at, expires_at }] }`,只含未撤销的,最新的在前                  |
| `POST /api/auth/tokens`       | 仅会话。请求体 `{ name, scopes, expires_at? }`,`scopes` 只能是 `["read"]` 或 `["write"]`;返回 `{ token, secret }`,这是明文唯一一次出现 |
| `DELETE /api/auth/tokens/:id` | 仅会话。撤销。重复撤销无害;不存在的 id 返回 404。返回 `{ id, action: "revoked", revoked_at }`                                          |

| 错误码                | 状态码 | 含义                                |
| --------------------- | ------ | ----------------------------------- |
| `INVALID_CREDENTIALS` | 401    | 密码不对                            |
| `AUTH_REQUIRED`       | 401    | 没有有效会话,也没有带令牌           |
| `INVALID_TOKEN`       | 401    | 带的令牌无效、已过期或已撤销        |
| `ALREADY_REGISTERED`  | 403    | 已有密码之后又尝试注册              |
| `REGISTRATION_CLOSED` | 403    | 启动后的 10 分钟已过;重启可重新打开 |
| `INSUFFICIENT_SCOPE`  | 403    | 只读令牌调用了会改动东西的路由      |
| `SESSION_REQUIRED`    | 403    | 用令牌调用了仅会话的路由            |
| `TOKEN_NOT_FOUND`     | 404    | 撤销一个从未存在过的 id             |

## 关键规则

- 注册之前,除认证域自身的端点与 `GET /api/system/health` 外,一切 `/api/*` 都返回 401 —— 还没有密码,任何登录都不可能成功。
- 注册之后,除认证域自身的端点(注册接口返回 `ALREADY_REGISTERED`)与 `GET /api/system/health`(Docker healthcheck 目标,不含业务数据)外,一切 `/api/*` 端点都必须携带有效会话,或档位足够的访问令牌。静态页面资源不做服务端门禁 —— 强制边界在 API 层,SPA 由客户端跳转注册页或登录页。其余未登录统一 401,百分号编码路径无法绕过守卫。
- 仅会话的路由对所有令牌返回 403 `SESSION_REQUIRED`,包括 `write`:AI 设置(里面有供应商密钥)、修改密码、令牌管理、`POST /api/memory/reset`。其余路由都接受令牌。
- 路由没有另行声明时,由方法决定档位:GET 和 HEAD 需要 `read`,其余方法需要 `write`。所以新路由一落地就被覆盖。聊天算写 —— 一句话可能落成一笔账。
- 带了令牌就只由令牌决定这次请求:令牌无效时,旁边有合法 Cookie 也返回 401;只读令牌旁边有合法 Cookie 也仍然只读。只有没带 `Bearer` 时才看 Cookie。
- 每把令牌记录"最近使用时间",最多每五分钟写一次。此外什么都不记:没有日志行、trace 或数据行说明是哪把令牌发的请求。
- 只有 PC 端(`/`)有注册页和令牌管理页。手机端(`/m/`)都不做:未注册时显示提示并指向 PC 端,不给登录表单。
- 修改密码需要当前密码,并且结束所有会话,包括发起修改的那个。入口只在 PC 设置页。
- Web 收到 401 回到登录页;写入请求不自动重试。
- 登录没有尝试次数限制:单用户服务,挡在运维者自己的网络边界之后。限流随第一个对公网暴露的部署一起落地。
- 不保存明文密码或令牌;密码、令牌、密钥不进源码、Git、配置或日志。
- 服务端与开发端口不对公网开放。
- 认证不改变写入规则:对谁都是校验加一个事务。
- 忘记密码没有重置流程:停掉服务端,删除 `data/auth.db`,重新启动后再注册一次,令牌也要重新创建。没有脚本可以做这件事 —— 只有 server 写数据库。

## 用访问令牌调用

写给自建客户端。在 PC 设置页创建令牌,然后每个请求都带上它:

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8629/api/ledger/months
```

- **读懂响应**:401 表示令牌无效、已过期或已撤销。403 `INSUFFICIENT_SCOPE` 表示只读令牌碰到了会改动东西的路由。403 `SESSION_REQUIRED` 表示这个路由仅限会话。
- **从浏览器页面调用**:服务端不发 CORS 头。页面如果和 `/api` 不同源,就把 `/api` 代理成同源,`pnpm run dev` 下的开发服务器是同样的做法。
- **trace 流**:`GET /api/traces/stream` 只能用基于 `fetch` 的流读取器来读,`EventSource` 带不了请求头。
- **令牌放在哪**:页面存储和脚本配置比 HttpOnly Cookie 更容易被读到。能用的档位里选最窄的那个。
