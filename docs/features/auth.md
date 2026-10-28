# Auth Domain: Public Single-User Access

English | [简体中文](auth.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Web login for exactly one user. Anyone not logged in cannot read schedules, use memory, generate proposals, or confirm writes. HTTPS only encrypts transport — it never replaces login; the public entrance keeps authentication on.

- **Owns**: login/logout/session query, unified auth protection, password hashing, session expiry and revocation.
- **Does not own**: multi-user, sign-up, password recovery, SMS, OAuth, admin consoles, public sharing.

## Core concepts

- Authentication is enabled explicitly via environment variables (setting the password hash turns it on); unconfigured keeps local-dev behavior with no login.
- Session tokens are high-entropy randoms; the server stores only SHA-256 digests and expiry; storage is in-memory — a restart invalidates everything.
- Cookies: HttpOnly, SameSite=Strict, plus Secure on public deployments; client-side JavaScript never reads the token.
- Session TTL and cookie safety flags come from `TOBY_AUTH_*` environment variables (details go to the operations doc when the domain lands).

## Interface

All JSON; errors follow the server's standard error body.

| Method and path         | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `POST /api/auth/login`  | Log in and start a session; wrong password 401                 |
| `POST /api/auth/logout` | Revoke the session; idempotent success even when not logged in |
| `GET /api/auth/session` | Query the session; `enabled: false` when authentication is off |

## Key rules

- With authentication on, every `/api/*` endpoint requires a valid session except the auth endpoints themselves (login, the idempotent logout, the session query that feeds the login page) and `GET /api/system/health` (the Docker healthcheck target; it carries no business data). Static page assets are served without server-side gating — the enforced boundary is the API; the SPA redirects to the login page client-side. Everything else answers a uniform 401, and percent-encoded paths cannot dodge the guard.
- The web returns to the login page on 401; proposal-confirmation requests never auto-retry.
- Login has no attempt limit: a single-user server behind the operator's own network boundary. A limiter lands with the first deployment exposed to the internet.
- No plaintext passwords or tokens are stored; passwords, tokens, and keys never enter source, Git, configs, or logs.
- The server and dev ports never open to the public internet.
- Authentication never changes the proposal rules: only explicitly confirmed proposals write.
