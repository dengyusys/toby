# AI Runs on the pi Ecosystem

English | [简体中文](ai-pi-runtime.zh.md)

Status: accepted (supersedes [ai-integration.md](ai-integration.md)) · Date: 2026-10-22

All AI transport and agent execution in this repository runs on the pi
ecosystem: [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)
as the unified LLM API and [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
as the agent loop. This replaces the previous hand-written OpenAI-compatible
fetch adapter and **reverses the earlier ban on endpoint-native tool
calling** — deliberately, and with the guardrails below.

## Why

- **Vendor independence with one dependency:** 20+ providers (zai/GLM,
  OpenAI, Anthropic, DeepSeek, …) behind one API; switching models is a
  one-line config change, not a code change.
- **Agent-first by design:** the product is "say one sentence, get a
  confirmed action". Tool calls with schema-validated arguments are the
  model's native, most reliable structured-output channel — more so than
  prompting for JSON and scraping it out of prose.
- **Correction becomes a loop:** a malformed draft is bounced back to the
  model as a tool error and fixed by the model itself, instead of one
  blind retry.
- **Observability for free:** every call carries token/cost usage, which
  lands in the structured log.

## What is fixed (unchanged red lines)

1. **The trust boundary is deterministic server-side validation.** Tool
   schemas (TypeBox) only constrain _shape_; semantic validation (amounts
   to integer cents, real calendar dates, entry bounds) stays hand-written
   in each domain. AI output — including tool arguments — is untrusted
   input, always.
2. **Every real effect goes through proposal → user confirmation →
   transactional execution.** The shared actions kernel (the
   proposal-confirmation state machine) lives
   in `infrastructure/actions/`; agents never write directly and never
   confirm on the user's behalf.
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
- **`write-intent`** — produces an effect, but only as a proposal; the
  effect happens solely after user confirmation. This covers future
  external actions (notifications) as much as database writes.

Today the only production agent (ledger extraction) allows both kinds;
the gate earns its keep with the next agent — the chat companion, which
will allow read-only only. A `costly` kind (web search, image generation)
is anticipated but not introduced until a domain needs it.

## Structure

- `infrastructure/ai/` and `infrastructure/actions/` hold the runtime (file
  roles are documented in the files themselves). Two non-obvious decisions:
  the single-shot `AiClient` keeps the tolerant-parse + one-retry JSON
  protocol and currently has no production caller (chat's intent
  classification is its expected first consumer); the actions kernel
  uses single-flight — concurrent confirms and the sweeper share one
  execution — with domains passing their executors at commit time.
- Domains own prompts, tools, and schemas: ledger's draft schema is
  defined once in TypeBox and is simultaneously the model-facing tool
  contract and the server's shape gate; validation.ts remains the
  semantic trust boundary.
- Versioning: pi-ai / pi-agent-core / typebox are pinned exact in the
  pnpm catalog (pnpm-workspace.yaml) — pi-agent-core depends on exact
  versions, and a caret would install a second pi-ai copy and split the
  types.

## Failure handling

Corrections ride the agent loop (error tool results + the turn cap); a
run that does not settle within its turns fails plainly as
`max-turns-exceeded` (HTTP 502 via the domain mapping). Provider auth
failures map to `unconfigured` (501); anything else transport-shaped maps
to `request-failed`/`timeout`.

## Configuration

- `TOBY_AI_MODEL` is a pi-ai "provider/model" pair (e.g. `zai/glm-4.7`);
  unset keeps the AI paths plainly unavailable (501). The pair is
  resolved against pi-ai's builtin model list at assembly — unknown pairs
  fail startup.
- Provider credentials live in pi-ai's per-provider environment variables
  (e.g. `ZAI_API_KEY`) or its credential store — never in Toby's own
  variables, never in the repository.

## Testing

Automated tests never call a real model: pi-ai's `fauxProvider` scripts
responses (including error stop reasons and slow streams), and the agent
factory accepts an injected model collection / stream function. Real-model
regression runs separately with explicit authorization.
