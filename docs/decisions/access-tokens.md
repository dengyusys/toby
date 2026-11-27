# Access Tokens: A Second Credential, the Same API

English | [简体中文](access-tokens.zh.md)

Access tokens let the owner's own programs — a self-built page, a script, an
agent — call the same `/api` routes the web apps call, with a bearer token in
place of the login cookie. A token is the owner, never another user.

**The reason: the API was reachable only through a browser session, so every
client had to be the shipped SPA. A second credential on the same routes
opens the API without a second API to maintain.**

## Why

- **One API.** No `/api/v1` and no parallel surface: a token opens what the
  web apps already use, so a feature is built once.
- **The owner, not an account.** The deployment has one user; a token is
  another way to prove it, with a name and a revoke button.
- **Credentials stay in the browser.** Tokens live in page storage and in
  script configuration — easier to leak than an HttpOnly cookie. So a token
  opens the business routes and nothing that manages the owner's credentials.

## The model

1. **One power.** Every token calls the business routes, reads and writes
   alike: a self-built page needs to send a sentence as much as to read. A
   token has a name, and that is all there is to choose.
2. **Session-only routes.** `config.sessionOnly` keeps a route to the browser
   session: the AI settings (they hold provider keys), token management, the
   password change, and the memory reset. A token answers
   `SESSION_REQUIRED`.
3. **Only the digest is stored.** `data/auth.db` keeps one `access_tokens`
   row per token: a SHA-256 digest, the last four characters for the list,
   and timestamps. The secret is returned once, at creation.
4. **The header, never the URL.** `Authorization: Bearer <token>`. Query
   strings reach the request log in clear; headers do not. A presented
   token decides the request on its own — a cookie beside it is ignored.
5. **Default-secure guard.** Every `/api` route still carries the guard. The
   guard now resolves a principal (session or token) and checks the route's
   rule, in one place, in the hook the composition root installs.
6. **One credential for the MCP gateway too.** The gateway's planned static
   `TOBY_MCP_TOKEN` ([mcp-gateway.md](mcp-gateway.md)) gives way to these
   tokens: when the gateway lands, its callers authenticate with them.

## Deliberately not in v1

- **CORS.** A browser page on another origin proxies `/api` same-origin, as
  the dev servers do. An allowlist arrives with the first page that cannot.
- **Per-request attribution.** Only "last used" is recorded: traces store
  nothing, and no row says which token wrote it.
- **Scopes and expiry.** Every token has the same power and lives until it
  is revoked. Tiers and expiry dates were tried and dropped: each is a
  second way for a token to stop working, and revoke is the only one anyone
  asked for.
- **Rate limiting.** The login posture stands — a single-user server behind
  the operator's own network boundary.

## Testing

The rule in isolation (`access.ts`), the token store against a real sqlite
file, and the production assembly through `app.inject`: every session-only
route, unknown / revoked tokens, and the cookie-plus-token precedence. The
root HTTP integration test creates a token on a real process and calls the
API with it.
