# Auth Domain: Public Single-User Access

English | [简体中文](auth.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests. The decision record is docs/decisions/first-run-registration.md.

## Responsibilities and boundaries

Web login for exactly one user. Anyone not logged in cannot read schedules, use memory, or write anything. HTTPS only encrypts transport — it never replaces login.

- **Owns**: first-run registration, login/logout/session query, unified auth protection, password hashing, session expiry and revocation.
- **Does not own**: multi-user, open sign-up, password recovery, SMS, OAuth, admin consoles, public sharing.

## Core concepts

- Login is always on; there is no password-less mode. The password is set once on the first-run registration page and its scrypt hash lives in the auth database (`data/auth.db`) — never in an environment variable.
- Registration is one-time and time-boxed: it works only while no password exists and only within 10 minutes after the server starts. A server left unregistered is closed, not open — a restart reopens the window.
- Session tokens are high-entropy randoms; the server stores only SHA-256 digests and expiry; storage is in-memory — a restart invalidates every session and keeps the password.
- Cookies: HttpOnly, SameSite=Strict, plus Secure on public deployments; client-side JavaScript never reads the token.
- Session TTL and cookie safety flags come from `TOBY_AUTH_*` environment variables (docs/operations/local-dev.md).

## Interface

All JSON; errors follow the server's standard error body.

| Method and path           | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register` | First-run registration: sets the password and starts a session. Body `{ password }` (8–256 characters)  |
| `POST /api/auth/login`    | Log in and start a session; wrong password 401 (before registration, every password is wrong)           |
| `POST /api/auth/logout`   | Revoke the session; idempotent success even when not logged in                                          |
| `GET /api/auth/session`   | Query the deployment's state: `unregistered`, `unauthenticated`, or `authenticated` (plus `expires_at`) |

| Code                  | Status | Meaning                                                    |
| --------------------- | ------ | ---------------------------------------------------------- |
| `INVALID_CREDENTIALS` | 401    | wrong password                                             |
| `AUTH_REQUIRED`       | 401    | no valid session on a guarded route                        |
| `ALREADY_REGISTERED`  | 403    | registration attempted after a password already exists     |
| `REGISTRATION_CLOSED` | 403    | the 10-minute startup window has passed; restart to reopen |

## Key rules

- Before registration, every `/api/*` endpoint except the auth endpoints and `GET /api/system/health` answers 401 — no password exists, so no login can succeed.
- After registration, every `/api/*` endpoint requires a valid session except the auth endpoints themselves (registration answers `ALREADY_REGISTERED`) and `GET /api/system/health` (the Docker healthcheck target; it carries no business data). Static page assets are served without server-side gating — the enforced boundary is the API; the SPA redirects to the registration or login page client-side. Everything else answers a uniform 401, and percent-encoded paths cannot dodge the guard.
- Only the PC app (`/`) has a registration page. The mobile app (`/m/`) has none: while unregistered it points at the PC app instead of showing a login form.
- The web returns to the login page on 401; write requests never auto-retry.
- Login has no attempt limit: a single-user server behind the operator's own network boundary. A limiter lands with the first deployment exposed to the internet.
- No plaintext passwords or tokens are stored; passwords, tokens, and keys never enter source, Git, configs, or logs.
- The server and dev ports never open to the public internet.
- Authentication never changes the write rules: writes are still validation plus one transaction, for everyone.
- A forgotten password has no reset flow: stop the server, delete `data/auth.db`, start again, register anew. Nothing scripts this — only the server writes to a database.
