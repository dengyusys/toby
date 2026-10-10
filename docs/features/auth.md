# Auth Domain: Public Single-User Access

English | [简体中文](auth.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.

## Responsibilities and boundaries

Provide web login for one user. Anyone not logged in cannot read schedules, use Memory, generate proposals, or confirm writes. HTTPS only encrypts transport and never replaces login; the public entrance keeps authentication enabled.

Owns: server login, logout, current-session query, and unified auth protection; web login page, staying logged in, logout, and session-expiry handling; password hashing, session expiry and revocation, login rate limiting, sanitized logs.

Does not own: multiple users, sign-up, password recovery, SMS, OAuth, an admin console, or public sharing.

## Behavior contract

### Interfaces

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Log in and establish a web session |
| `POST /api/v1/auth/logout` | Revoke the current session |
| `GET /api/v1/auth/session` | Query the current session |

Auth is enabled explicitly by environment variables; without a password hash configured, auth is disabled and the server keeps local-dev behavior:

| Setting | Default | Notes |
| --- | --- | --- |
| `TOBY_AUTH_PASSWORD_HASH` | none | scrypt password hash; setting it enables auth; generate with `pnpm run auth:hash-password` |
| `TOBY_AUTH_SESSION_TTL_MS` | `604800000` (7 days) | Session lifetime; re-login required after expiry |
| `TOBY_AUTH_COOKIE_SECURE` | `false` | `Secure` attribute of the session cookie; must be `false` for local HTTP, `true` for public HTTPS deployment |
| `TOBY_AUTH_LOGIN_RATE_LIMIT` | `5` | Login rate-limit count (per client IP, fixed window) |
| `TOBY_AUTH_LOGIN_RATE_WINDOW_MS` | `60000` | Login rate-limit window |

### Requests and responses

Auth requests with bodies use JSON, capped at 16 KiB. Error responses are uniformly `{ "error": { "code", "message" } }`.

**`POST /api/v1/auth/login`**

- Body: `{ "password": "..." }`
- Success `200`: `{ "session": { "expires_at": "<ISO 8601>" } }`, with `Set-Cookie`.
- `400` `INVALID_REQUEST`: missing password or body is not valid JSON.
- `401` `INVALID_CREDENTIALS`: wrong password (single user, no username).
- `429` `RATE_LIMITED`: login rate limit exceeded, with a `Retry-After` header.

**`POST /api/v1/auth/logout`**

- The client currently sends an empty JSON object `{}`; the server neither reads nor validates the logout body — that convention is a client habit, not an enforced contract.
- Success `200`: `{ "ok": true }`, revoking the session and clearing the cookie; idempotent success when not logged in.

**`GET /api/v1/auth/session`**

- Success `200`: `{ "enabled": true, "session": { "expires_at": "<ISO 8601>" } }`.
- Not logged in `401`: `{ "error": { "code": "UNAUTHORIZED", "message": "请先登录" } }`.
- Auth disabled returns `200`: `{ "enabled": false }`; the web treats this as "no login needed".

### Session storage and protection scope

- Session tokens are 256-bit random values (base64url); the server stores only the SHA-256 digest and expiry; in-memory storage — everything invalidates on process restart.
- The cookie is named `toby_session`, attributes `HttpOnly; SameSite=Strict; Path=/; Max-Age=<lifetime>`, with `Secure` appended per config in public deployment.
- With auth enabled, every page and `/api/*` path must carry a valid session cookie except the following exemptions, otherwise `401`:
  - The auth endpoints themselves (login/logout/session; logout is idempotent even when not logged in).
  - Static page assets (login UI only, no business data): PC `/`, `/favicon.svg`, `/assets/*`, `/js/*`, `/css/*`; mobile `/m`, `/m/`, `/m/favicon.svg`, `/m/assets|js|css/*` (ADR "splitting the web into dual apps").
- Unauthenticated access to protected paths uniformly returns `{ "error": { "code": "UNAUTHORIZED", "message": "请先登录" } }`; on `401` the web returns to the login page, and proposal-confirmation requests are never auto-retried.

## Security boundaries

- Required: all business pages and business APIs require login by default; the web uses `HttpOnly`, `Secure`, `SameSite=Strict` cookies; client JavaScript never reads or stores tokens.
- Forbidden: the server storing plaintext passwords or tokens; passwords, tokens, or secrets entering source code, Git, public config, or logs.
- Forbidden: exposing `8629` or the dev ports (`8630`/`8631`) directly to the public internet.
- Unchanged: existing proposal rules are unaffected by auth — writes happen only after the user explicitly confirms with a `proposal_id`.

## Acceptance

- Not yet verified: a retest on cellular networks (non-blocking).

Automated coverage lives in `apps/server/test/` (not logged in, wrong password, logout, expiry, revocation scenarios).
