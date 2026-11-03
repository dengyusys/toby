# Traces Domain: AI Call Monitor

English | [简体中文](traces.zh.md)

> Target contract: the live observation channel for every AI call; implementation details live in code and tests.

## Responsibilities and boundaries

The observability counterpart to the AI runtime (docs/decisions/ai-pi-runtime.md): every call to a model — the agent tool loop and the single-shot client alike — reports to an in-memory trace bus, and this domain streams the bus to the web monitor panel. Console semantics, browser-console style: **nothing is stored** — an observer attached before a call sees it, one that joins late does not, and restarting the server clears the feed.

- **Owns**: `GET /api/traces/stream`, the one SSE endpoint.
- **Does not own**: any persistence (no `data/` file, no history API); the capture itself (that is `infrastructure/trace/`, called by the model layer).

## Core concepts

- **Trace bus** (`infrastructure/trace/bus.ts`): fan-out only. The composition root creates one bus and hands the same instance to the AI runtime (as its reporter) and this domain (as its stream source) — the only cross-domain wiring, done in `app.ts`.
- **Two events per run**: `run-started` goes out the moment a call begins (prompt visible under a running marker); `run-finished` closes it with the full transcript — system prompt and tool declarations, user inputs, assistant turns with thinking/tool calls, tool results — plus outcome, usage (tokens, cost), and duration. `run-finished` is self-contained: a client that somehow missed `run-started` can still render the run.
- **Capture points**: `createTobyAgentFactory` (kind `agent`, label from the spec's `name`, e.g. `ledger-extraction`) and `createPiAiClient` (kind `single-shot`, label `complete`; a JSON retry is its own run with the correction prompt visible).
- **The panel** (`apps/web` only): a right-side drawer the layout's top-right button toggles — no page switch, it splits the main area beside the current page. The SPA holds one EventSource for the whole logged-in session (mounted with the gated routes), so runs keep flowing in on every page — the drawer is a view over that stream, accumulating in the browser (capped). `apps/web-mobile` deliberately has no panel.

## Interface

One endpoint, session-guarded like every `/api` route (transcripts are personal data — no public opt-out):

| Method and path          | Purpose                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `GET /api/traces/stream` | SSE: `trace` events (`run-started` / `run-finished`), heartbeat comments every 15 s, `: connected` frame on open |

Event payloads (`TraceEvent`, snake_case, mirrored in `packages/contract/src/trace-events.ts`):

- `run-started` → `{type, run: {id, kind, label, model, prompt, started_at}}`
- `run-finished` → `{type, run: {…started fields, duration_ms, status: "succeeded"\|"failed", messages, result_text?, error?, stop_reason?, turns?, usage?}}`
- `messages` entries are normalized away from the provider SDK (`system` with optional tool declarations, `user`, `assistant` with `tool_calls`/`thinking`/`usage`, `tool_result`, or `unknown` with the raw value).

## Key rules

- **No storage, ever.** The bus keeps no history and the domain exposes none; `data/` stays untouched. History is the observer's (the page caps itself).
- **The feed never breaks the call.** A throwing listener is isolated; capture is best-effort — if reporting fails, the AI call still runs.
- **No new AI call paths bypass it.** Any future model caller (the chat agent, classifiers) goes through the traced factory/client; a bypassing caller is a defect of this contract.
