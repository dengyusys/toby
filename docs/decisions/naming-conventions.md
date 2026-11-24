# Naming Conventions

English | [简体中文](naming-conventions.zh.md)

**One map of which naming style every layer of this project uses. One row
is a Toby decision; the rest follow the ecosystem defaults of their
language, recorded here so nobody re-derives them.**

## The map

| Layer                                           | Style             | Examples                                      |
| ----------------------------------------------- | ----------------- | --------------------------------------------- |
| HTTP JSON fields, Toby-owned                    | snake_case        | `turn_id`, `masked_key`, `income_total`       |
| HTTP JSON fields, carried from upstream (pi-ai) | upstream spelling | `stopReason`, `toolCallId`, `content` blocks  |
| SQL tables and columns                          | snake_case        | `setting_key`, `credential_json`              |
| TypeScript locals and functions                 | camelCase         | `incomeTotal`, `formatCents`                  |
| TypeScript types and interfaces                 | PascalCase        | `AiSettingsView`, `LedgerTransactionRow`      |
| React props and state (app-internal)            | camelCase         | `apiKey`, `onChange`                          |
| Environment variables, module constants         | UPPER_SNAKE       | `TOBY_AI_MODEL`, `AGENT_HISTORY_MAX_CHARS`    |
| Wire string values: error codes                 | SCREAMING_SNAKE   | `SETTINGS_INVALID_MODEL`, `RATE_LIMITED`      |
| Wire string values: stages, intents, statuses   | lowercase words   | `request-failed`, `ledger`, `stored`\|`env`   |
| File names                                      | kebab-case        | `settings-client.ts`, `naming-conventions.md` |

The test for any new name: **does it cross HTTP or enter the database?**
A Toby-owned name there → snake_case. A value carried from upstream →
untouched. Anything living only in TypeScript or React → camelCase.
Constants and env vars → UPPER_SNAKE.

## The decided row: JSON fields

Two vocabularies meet on every API surface:

- **Own fields** — names Toby defines — are snake_case, matching the SQL
  column names they usually mirror one-to-one.
- **Carried values** — shapes owned upstream, above all pi-ai messages and
  their nested fields — keep the upstream spelling untouched.
  Zero-translation replay is a stronger contract than any casing rule:
  chat items and trace events store and serve these values verbatim.

The rule binds the API JSON only: TypeScript locals stay camelCase, React
props are app-internal camelCase, env vars are UPPER_SNAKE. The two worlds
meet at exactly one point — a camelCase local becomes a snake_case key
once, at the boundary (`incomeTotal` returned as `income_total`).

## History

Settings landed with camelCase own fields (`maskedKey`, `chatHistoryHours`,
`apiKey`, `latencyMs`) before the rule was stated — and the statement lived
in `docs/features/traces.md`, one domain's feature doc, where nobody looks
for a repo-wide rule. On 2026-11-24 all four were renamed to snake_case and
the rule moved here.

## Why a hard cut

Single-process deployment (`pnpm run start` serves pages and API from one
build) and a single self-hosted user mean the server and both webs always
ship together — a dual-name compatibility layer would serve nobody. Stored
data is unaffected: settings persist scalar rows and credential JSON, and
field names never enter the database.
