# Auth Domain: Public Single-User Access

English | [简体中文](auth.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests. The decision records are docs/decisions/first-run-registration.md and docs/decisions/access-tokens.md.

## Responsibilities and boundaries

Web login for exactly one user, and access tokens for that user's own programs. Anyone without a session or a token cannot read schedules, use memory, or write anything. HTTPS only encrypts transport — it never replaces login.

- **Owns**: first-run registration, login/logout/session query, the password change, access tokens, unified auth protection, password hashing, session expiry and revocation.
- **Does not own**: multi-user, open sign-up, password recovery, SMS, OAuth, admin consoles, public sharing, CORS.

## Core concepts

- Login is always on; there is no password-less mode. The password is set once on the first-run registration page and its scrypt hash lives in the auth database (`data/auth.db`) — never in an environment variable.
- Registration is one-time and time-boxed: it works only while no password exists and only within 10 minutes after the server starts. A server left unregistered is closed, not open — a restart reopens the window.
- Session tokens are high-entropy randoms; the server stores only SHA-256 digests and expiry; storage is in-memory — a restart invalidates every session and keeps the password.
- Cookies: HttpOnly, SameSite=Strict, plus Secure on public deployments; client-side JavaScript never reads the token.
- Session TTL and cookie safety flags come from `TOBY_AUTH_*` environment variables (docs/operations/local-dev.md).
- An access token is the owner's second credential: a bearer secret for the owner's own programs — a self-built page, a script, an agent — calling the same `/api` routes the web apps call. It is the owner, never another user.
- Every token has the same power: the owner's business routes, reads and writes alike. A route that must stay with the browser — anything that manages credentials — refuses tokens with `config.sessionOnly`.
- Only a token's SHA-256 digest and last four characters are stored (`data/auth.db`); the secret is returned once, at creation. It travels in `Authorization: Bearer <token>` — never in a URL, which reaches the request log in clear.
- A token does not expire; revoking it is the one way it stops working. Changing the password leaves tokens alone — they are revoked one by one.

## Interface

All JSON; errors follow the server's standard error body.

| Method and path               | Purpose                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`     | First-run registration: sets the password and starts a session. Body `{ password }` (any non-empty password)                                |
| `POST /api/auth/login`        | Log in and start a session; wrong password 401 (before registration, every password is wrong)                                               |
| `PUT /api/auth/password`      | Session only. Change the password. Body `{ current_password, new_password }` (new: any non-empty password, must differ); ends every session |
| `POST /api/auth/logout`       | Revoke the session; idempotent success even when not logged in                                                                              |
| `GET /api/auth/session`       | Query the deployment's state: `unregistered`, `unauthenticated`, or `authenticated` (plus `expires_at`)                                     |
| `GET /api/auth/tokens`        | Session only. `{ tokens: [{ id, name, last_four, created_at, last_used_at }] }` — not revoked, newest first                                 |
| `POST /api/auth/tokens`       | Session only. Body `{ name }`; answers `{ token, secret }`, the only time the secret exists                                                 |
| `DELETE /api/auth/tokens/:id` | Session only. Revoke. Twice is harmless; an id that never existed is 404. Answers `{ id, action: "revoked", revoked_at }`                   |

| Code                  | Status | Meaning                                                    |
| --------------------- | ------ | ---------------------------------------------------------- |
| `INVALID_CREDENTIALS` | 401    | wrong password                                             |
| `AUTH_REQUIRED`       | 401    | no valid session and no token presented                    |
| `INVALID_TOKEN`       | 401    | a presented token is unknown or revoked                    |
| `ALREADY_REGISTERED`  | 403    | registration attempted after a password already exists     |
| `REGISTRATION_CLOSED` | 403    | the 10-minute startup window has passed; restart to reopen |
| `SESSION_REQUIRED`    | 403    | a token on a session-only route                            |
| `TOKEN_NOT_FOUND`     | 404    | revoking an id that never existed                          |

## Key rules

- Before registration, every `/api/*` endpoint except the auth endpoints and `GET /api/system/health` answers 401 — no password exists, so no login can succeed.
- After registration, every `/api/*` endpoint requires a valid session or an access token, except the auth endpoints themselves (registration answers `ALREADY_REGISTERED`) and `GET /api/system/health` (the Docker healthcheck target; it carries no business data). Static page assets are served without server-side gating — the enforced boundary is the API; the SPA redirects to the registration or login page client-side. Everything else answers a uniform 401, and percent-encoded paths cannot dodge the guard.
- Session-only routes answer 403 `SESSION_REQUIRED` to every token: the AI settings (they hold provider keys), the password change, token management, and `POST /api/memory/reset`. Every other route takes a token.
- A presented token decides the request on its own: an invalid one is 401 even beside a valid cookie, and a session-only route still refuses a token beside one. The cookie is consulted only when no `Bearer` was presented.
- "Last used" is recorded per token, at most once every five minutes. Nothing else is: no log line, trace, or stored row says which token made a request.
- Only the PC app (`/`) has a registration page and a token management page. The mobile app (`/m/`) has neither: while unregistered it points at the PC app instead of showing a login form.
- Changing the password needs the current one and ends every session, the caller's included. Only the PC settings page offers it.
- The web returns to the login page on 401; write requests never auto-retry.
- Login has no attempt limit: a single-user server behind the operator's own network boundary. A limiter lands with the first deployment exposed to the internet.
- No plaintext passwords or tokens are stored; passwords, tokens, and keys never enter source, Git, configs, or logs.
- The server and dev ports never open to the public internet.
- Authentication never changes the write rules: writes are still validation plus one transaction, for everyone.
- A forgotten password has no reset flow: stop the server, delete `data/auth.db`, start again, register anew — and create tokens again. Nothing scripts this — only the server writes to a database.

## Calling with an access token

For a self-built client. Create the token on the PC settings page, then send it on every request:

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8629/api/ledger/months
```

- **Read the answer**: 401 means the token is unknown or revoked. 403 `SESSION_REQUIRED` means the route is session-only.
- **From a browser page**: the server sends no CORS headers. A page served from another origin than `/api` proxies `/api` same-origin, as the dev servers do under `pnpm run dev`.
- **The trace stream**: `GET /api/traces/stream` is readable only through a `fetch`-based stream reader — `EventSource` cannot send the header.
- **Where the token lives**: page storage and script configuration are easier to reach than an HttpOnly cookie. Keep each token to where it is used, and revoke it when it is no longer needed.
