# AI Runs on the pi Ecosystem

English | [简体中文](ai-pi-runtime.zh.md)

All AI transport and agent execution in this repository runs on the pi
ecosystem: [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)
as the unified LLM API and [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
as the agent loop. The guardrails below are part of the deal.

## Why

- **Vendor independence with one dependency:** 20+ providers (zai/GLM,
  OpenAI, Anthropic, DeepSeek, …) behind one API; switching models is a
  one-line config change, not a code change.
- **Agent-first by design:** the product is "say one sentence, get a
  landed write". Tool calls with schema-validated arguments are the
  model's native, most reliable structured-output channel — more so than
  prompting for JSON and scraping it out of prose.
- **Correction becomes a loop:** a malformed draft is bounced back to the
  model as a tool error and fixed by the model itself, instead of one
  blind retry.
- **Observability for free:** every call carries token/cost usage, which
  the in-memory trace bus streams live to the web monitor
  (docs/features/traces.md) — nothing is logged or stored.

## What is fixed (unchanged red lines)

1. **The trust boundary is deterministic server-side validation.** Tool
   schemas (Zod, converted to JSON Schema at the pi boundary) only constrain _shape_; semantic validation (amounts
   to integer cents, real calendar dates, entry bounds) stays hand-written
   in each domain. Since pi 1.5.0 the boundary validates through pi-schema
   _with coercion_: loosely typed tool arguments (numeric strings, a bare
   value where an array is declared) are coerced to the schema's shape
   instead of bounced — coercion can re-type and even truncate, so nothing
   reaches a domain on the strength of coercion alone; the hand-written
   gate still decides. `format` keywords are annotations there (the
   draft 2020-12 default), so format semantics likewise stay in domain
   validation. AI output — including tool arguments — is untrusted input,
   always.
2. **Every real effect is one transactional write.**
   The AI produces a draft;
   deterministic validation gates it; the domain's repository executes it
   in a single transaction. There is no proposal machinery and no
   confirmation gate — a sentence the AI cannot resolve gets a clarifying
   question (never a guess), and backups are the recovery path.
3. **Prohibited capabilities are absent, not blocked.** There is no shell
   tool, no file-system tool, no direct-database tool — they do not exist
   as tool definitions at all.

## Tool kinds

Every tool registered through `defineTool` carries one of two kinds, and
an agent's policy states which kinds it may execute; the `beforeToolCall`
gate enforces the kind policy on every call. Unknown tool names (model
hallucinations) are rejected by pi-agent-core before the gate even runs;
the gate re-checks registration as a cheap invariant:

- **`read-only`** — no state change of any kind: queries, computations,
  and asking the user a clarifying question all belong here.
- **`write-intent`** — produces a real effect: a validated, transactional
  write. This covers future external
  actions (notifications) as much as database writes.

Today the only production agent (ledger extraction) allows both kinds;
the gate earns its keep with the next agent — the chat agent, which
will allow read-only only. A `costly` kind (web search, image generation)
is anticipated but not introduced until a domain needs it.

## Structure

- Two sibling layers, neither containing the other:
  `infrastructure/model/` is the AI runtime (agent loop, single-shot
  client, model catalog, and the error/type contract); the write path is
  owned by each domain's repository — one transaction per write, no
  shared kernel. One non-obvious
  decision:
  the single-shot `AiClient` keeps the tolerant-parse + one-retry JSON
  protocol and currently has no production caller (chat's intent
  classification is its expected first consumer).
- Domains own prompts, tools, and schemas: ledger's draft schema is
  defined once in Zod and is simultaneously the model-facing tool
  contract and the server's shape gate; validation.ts remains the
  semantic trust boundary. The runtime renders each agent's system prompt
  (`prompt.ts`): the domain writes the preamble, rules, and per-run
  context, while the `<tools>` section is generated from each tool's
  `promptSnippet` / `promptGuidelines` — hand-written prompt text never
  names a tool, so a rename cannot leave a stale mention behind.
- Versioning: pi-ai / pi-agent-core / pi-schema are pinned exact in the
  pnpm catalog (pnpm-workspace.yaml) — pi-agent-core depends on exact
  versions, and a caret would install a second copy and split the
  types. pi-schema is also a direct dependency: `tool-schema.ts` compiles
  every emitted tool schema at boot (pi-ai validates tool arguments with
  pi-schema at run time), so a schema pi cannot compile fails assembly,
  not a production run.

## Failure handling

Corrections ride the agent loop (error tool results + the turn cap); a
run that does not settle within its turns fails plainly as
`max-turns-exceeded` (HTTP 502 via the domain mapping). Provider auth
failures map to `unconfigured` (501); anything else transport-shaped maps
to `request-failed`/`timeout`.

## Configuration

- `TOBY_AI_MODEL` is a pi-ai "provider/model" pair (e.g. `zai/glm-4.7`);
  unset keeps the AI paths plainly unavailable (501). Since the settings
  domain (docs/decisions/ai-runtime-settings.md) the runtime resolves the
  effective pair per request — settings database first, env fallback —
  while an unknown env pair still fails startup.
- Provider credentials live in pi-ai's per-provider environment variables
  (e.g. `DEEPSEEK_API_KEY`), its credential store, or — since
  docs/decisions/ai-runtime-settings.md — in the settings database
  through pi-ai's CredentialStore port, where a stored credential wins
  over env. Never in `TOBY_*` variables, never in the repository.

## Testing

Automated tests never call a real model: pi-ai's `fauxProvider` scripts
responses (including error stop reasons and slow streams), and the agent
factory accepts an injected model collection / stream function. Real-model
regression runs separately with explicit authorization.
