# Settings Domain: Runtime-Configurable AI

English | [简体中文](settings.zh.md)

> Landed contract; implementation details live in code and tests. The
> decision record is docs/decisions/ai-runtime-settings.md.

## Responsibilities and boundaries

The settings domain owns the runtime-editable AI configuration: which
model answers and the per-provider API keys — persisted in its own
per-domain database (`data/settings.db`), editable from the PC settings
page, effective on the very next AI request.

- **Owns**: `/api/settings/ai` (read/write) and
  `/api/settings/ai/catalog`; the `settings` and `provider_credentials`
  tables; the masked view of stored credentials; the runtime config
  resolver the AI clients and agent factory consume.
- **Does not own**: model transport or catalog contents (pi-ai's builtin
  catalog, shared instance), the AI request paths themselves, or any
  other domain's configuration.

## Core concepts

- **Effective model**: database row → `TOBY_AI_MODEL` → none (unset
  everywhere = the AI paths stay at 501). The view reports the `source`:
  `"db"`, `"env"`, or `null`. The request timeout is deliberately not a
  setting — `TOBY_AI_TIMEOUT_MS` (default 30s) remains the ops knob.
- **Credentials are pi-ai credentials**: the `provider_credentials`
  table stores pi-ai `Credential` JSON (v1: `{"type":"api_key","key":…}`)
  and is exposed to pi-ai through its own `CredentialStore` port, so a
  stored key wins over the provider's env var while nothing is stored.
  Keys are plaintext at rest — the posture and its trade-off are
  recorded in the ADR.
- **Masked previews only**: a stored key is never returned in full; the
  view carries `maskedKey` (first 3 + `…` + last 4; ≤ 8 chars mask
  entirely) and the settings page's password input is never echoed.
- **One transactional write**: the whole PUT — settings upserts/deletes
  and credential upserts/deletes together — lands in a single
  transaction or not at all.

## Interface

All routes sit behind the default session guard (none is public). Errors
use the server's one error body with these codes:

| Code                          | Status | Meaning                                       |
| ----------------------------- | ------ | --------------------------------------------- |
| `SETTINGS_INVALID_MODEL`      | 400    | model is not a `provider/model` pair          |
| `SETTINGS_UNKNOWN_PROVIDER`   | 400    | credential provider not in the catalog        |
| `SETTINGS_INVALID_CREDENTIAL` | 400    | empty key, or set-and-clear in one entry      |
| `SETTINGS_BODY_INVALID`       | 400    | body shape rejected (unknown fields included) |

| Method and path                | Purpose                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/settings/ai`         | Effective view: `model` (`{value, source}`), `providers` (configured ones only: `{id, source: "stored"\|"env", maskedKey}`)                                                         |
| `PUT /api/settings/ai`         | Body `{model?: string\|null, credentials?: [{provider, apiKey?, clear?}]}`; omitted = unchanged, `null`/`clear` removes (env fallback returns); answers with the new effective view |
| `GET /api/settings/ai/catalog` | pi-ai's builtin catalog grouped by provider: `{providers: [{id, models: […]]}]`                                                                                                     |

## Key rules

- Runtime effect is exact: the AI client and agent factory re-resolve the
  effective config on every request (two SQLite point reads — no cache,
  no restart); a model change applies to the next call.
- A model row that no longer resolves in the catalog degrades as a typed
  AI error on request, never a boot failure.
- With no model configured anywhere, every AI path keeps answering the
  same 501 (`AI_UNAVAILABLE` / `unconfigured`) as the env-only era; the
  unconfigured copy points at the settings page first, the env var
  second.
- The catalog instance serving `GET …/catalog` is the same pi-ai
  collection the runtime streams through — the dropdown cannot drift
  from what the server can actually call.
- The mobile app does not configure settings in v1; the API is
  client-agnostic and the contract lives in `@toby/contract`
  (`createSettingsClient`).
