# AI Model Settings: Runtime-Configurable, Stored Server-Side

English | [简体中文](ai-runtime-settings.zh.md)

The AI model and the per-provider API keys are configurable
at runtime from the web settings pages (PC and mobile). Persistence is
server-side: a
new `settings` domain with its own per-domain database
(`data/settings.db`), where API keys are stored as pi-ai credentials
through pi-ai's own `CredentialStore` port. A settings write takes effect
on the next AI request — no restart, no reload. The request timeout is
deliberately NOT a user setting: it stays an ops concern via
`TOBY_AI_TIMEOUT_MS` (default 30s).

## Why

- **The key must live where the calls happen.** All AI transport runs in
  the server process (`infrastructure/model/`), so the credential has to
  be resolvable server-side at call time. Browser storage would force the
  key to travel with every request — strictly worse than storing it.
  "Configurable from the frontend" means the _UI_ is in the frontend,
  never the storage.
- **pi-ai already defines the credential port.** Implementing its
  `CredentialStore` over SQLite — instead of inventing a settings format
  — yields the right semantics for free: a stored credential owns the
  provider, ambient env vars answer only when nothing is stored, and
  `modify` stays a serialized read-modify-write, which is exactly the
  repository rule ("one validated, transactional write").
- **A table is the cheapest correct shape.** One KV table for non-secret
  settings plus one credentials table follows the per-domain database
  layout; file-based storage would break the transactional-write rule.

## What is stored, and who wins

| Setting          | DB key          | Fallback                              | Unset everywhere      |
| ---------------- | --------------- | ------------------------------------- | --------------------- |
| Model            | `ai.model`      | `TOBY_AI_MODEL`                       | AI paths answer 501   |
| Provider API key | credentials row | provider env var (e.g. `ZAI_API_KEY`) | Provider unconfigured |

Resolution is per request. Model validation (the `provider/model` pattern)
is shared between the env parser and the settings API, so the two sources
cannot drift: an env pair that fails startup validation also fails the
PUT that would store it.

## Security posture

- **Keys are plaintext in `data/settings.db`.** `data/` is already the
  security boundary — the SQLite databases themselves live there, and
  everything under `data/` is production data nobody touches by default.
  At-rest encryption would add a master-key management burden (lose the
  key, lose every stored credential) without moving the boundary;
  encrypting just the credentials table remains a possible future change.
- **Read APIs never return a key.** The settings surface answers with a
  masked preview (`sk-…abc`) and a source (`stored` / `env`) only. The
  settings page's password input is never echoed and is cleared after a
  successful save.
- **The routes sit behind the default session guard.** With
  authentication disabled, their exposure matches every other route in
  that mode — settings do not introduce a new posture.
- Keys never enter source, docs, logs, traces, or test fixtures.

## Runtime application

The single-shot client and the agent factory resolve the effective
config and catalog model per request (a sync lookup; negligible), so a
settings write applies to the very next call. "No model configured
anywhere" keeps answering `unconfigured` (501) through the existing
chat/ledger mapping — identical wire behavior to the env-only era.
`TOBY_AI_*` remain first-class bootstrap: existing deployments keep
working untouched, and the settings UI simply overrides them.

## Testing

Automated tests never touch real keys or real providers: temp data
directories, fake key strings, faux providers. A runtime-switch test
proves that changing the model in the database changes what the next
request uses.
