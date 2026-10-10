# Greeting Domain

English | [简体中文](greeting.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: in-domain decision history (SSE channel and entry greeting, domain rename) is in the Decision Records at the end; chat-page integration follows [the chat domain's "unified conversational interface" decision](chat.md).

## Responsibilities and boundaries

Every time the user opens (or refreshes) the web app, the companion says hello first.

- After conversation history is restored, the web opens one SSE long connection to the server; on connect it receives one greeting generated for the local time of day (AI-generated with fixed-copy fallback); afterwards only keepalive.
- The greeting displays for that visit only; nothing is written to any database.
- Since 2026-10-02 the same channel carries `chat-progress` events for conversation processing stages: while waiting for a reply, the waiting-status line shows the actual behavior in progress (understanding your words → checking the schedule / opening the ledger…).

**Owns**: the `GET /api/v1/greeting` event-stream endpoint; greeting generation (AI + time-of-day fallback) and the 30-second dedup window; conversation-processing stage broadcast (chat-progress, pushed to all online connections through the progress hub); the web side of connecting, displaying the entry greeting, and showing real stages in the waiting status.

**Does not own**: morning briefings, todo reminders, or other pushed content (long-term candidates — see the [todo domain doc](todo.md)); two-way communication; greeting persistence or history review; multi-user presence.

## Behavior contract

### Interface

`GET /api/v1/greeting?tz=<IANA timezone>`, an SSE event stream (`text/event-stream; charset=utf-8`, `Cache-Control: no-store`); session cookie required when auth is enabled (same-origin EventSource carries it automatically); 401 when not logged in; 405 on method mismatch.

| Frame or scenario | Timing | Content |
| --- | --- | --- |
| `event: greeting` | On connection, if the dedup window admits — before any keepalive frame | `data` is JSON: `{ message, generated_at, source }`, `source` ∈ `ai`/`fallback` |
| `event: chat-progress` | When conversation processing advances a stage (before intent classification, before each domain's proposal, before each companion tool call executes) | `data` is JSON: `{ text }`, `text` a display-ready phrase (e.g. "理解你的话", "核对日程", "翻账本"); broadcast to all online connections, best-effort — silently dropped with no connections, delivery failure never affects the conversation |
| `: ping` comment frame | Every 25 seconds thereafter | No payload, keeps the connection alive; produces no client event |
| No greeting frame | Reconnect within the dedup window | Keepalive only; after the window expires, a new connection gets a greeting again (chat-progress is not deduped — broadcast per event) |

### Key rules

- The greeting **never fails to arrive**: with no AI key configured, call failure, timeout, or output failing checks (empty / over 80 characters), it falls back to fixed time-of-day copy; the greeting service never throws outward.
- The greeting addresses the user as 「先生」 (user decision, 2026-09-26): the AI prompt and the fallback copy follow the same discipline.
- Time of day follows the user's timezone: the `tz` query parameter (the frontend reads the browser `Intl` timezone) goes through wall-clock conversion; a missing or invalid parameter falls back to UTC.
- The dedup window is 30 seconds, keyed by the digest of the session cookie token (by IP when auth is disabled): it blocks duplicate greetings from auto-reconnects and dev-time double mounts; after the window expires, entering again always greets again.
- Greetings **are never persisted**: the web appends it as an assistant message under a local `greeting_`-prefixed id — gone on refresh, never entering `data/chat.db`, never part of intent routing or proposals.
- `chat-progress` stage phrases are broadcast deterministically by the server on the processing path (not AI-generated): distillation probe "整理这几天的对话", intent classification "理解你的话", per-domain proposals "核对日程/核对账目/誊写手账/张罗告示板/记下要点", companion reply "琢磨怎么答你" (attachment path "看你的附件"), and each tool call via the `TOOL_PROGRESS_PHRASES` table (翻账本/翻日程/翻手账/回想记忆/看告示板, unknown falls back to "查资料"). The web displays them verbatim on arrival; if events don't arrive or the channel is down, it falls back to locally rotating filler words. Cleared when the reply lands; never persisted.
- The web connects to the greeting channel **only after conversation-history restoration completes** (including the restoration-failure path), so the greeting is never overwritten by history restore; connection errors (including 401) close silently without auto-reconnect — session expiry is handled by the global 401 flow.

### User path

Open the web app → history restores → greeting connects → the greeting appears at the end of the message stream → normal conversation; closing the page drops the connection, and entering again repeats the path.

## Security boundaries

- Required: the endpoint sits inside the auth scope; the dedup key stores only the SHA-256 digest of the token, never plaintext.
- Forbidden: the greeting channel carrying any write instruction or data payload (chat-progress is a read-only broadcast, not a control plane); bypassing the unified error envelope by writing errors after the stream opens (greeting generation happens before the stream takes over).

## Acceptance

Automated and passing: greeting service unit tests (time-of-day fallback / AI output cleanup / failure fallback, `apps/server/test/greeting-service.test.ts`), progress-hub unit tests (register/remove/broadcast/remove-on-write-failure, `apps/server/test/greeting-hub.test.ts`), HTTP integration (stream response headers, greeting frame, dedup window and window expiry, 405/401, chat-progress broadcast frames and silent disconnect, `apps/server/test/greeting-api.test.ts`), conversation stage sequencing (chat-integration: broadcast order on intent/domain/companion paths, callback errors never affecting the conversation), web (greeting display order and connection close, ThinkingStatus fixed real-stage display with rotating fallback, `apps/web/test/`). Real-AI blind testing (greeting on entry, wording varying by time of day, fixed copy without a key; waiting status tracking real stages, per-tool phrase rolling while the companion looks things up) awaits user review.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-09-26 · Heartbeat greeting: SSE long connection and the entry greeting

**Background**: once chat history persisted, re-entering the app auto-restored the latest conversation, but the companion was "mute" — it never spoke first; the user asked for a "heartbeat": say a greeting on every entry. The repository had no long-connection implementation at all; the todo domain had explicitly recorded "no push channel on the web".
**Trade-off**: SSE over WebSocket — the need is purely one-way (one greeting + keepalive), the browser's native `EventSource` brings its own reconnect semantics, and SSE routes fall under the existing cookie auth guard with zero changes (a WebSocket upgrade needs separate auth handling, plus a dependency, and the two-way capability would go unused); greet on connect, keepalive only afterwards (25-second comment frames); AI-generated greeting with fixed time-of-day copy fallback, service never throwing — "always there" beats "always smart", and local no-key development works fully; greetings not persisted — the semantics are "one greeting per entry", and persisting would pile up and need cleanup policy; a 30-second dedup window keyed by session identity blocks auto-reconnect and dev double-mount duplicates. Rejected: a plain GET on entry (no heartbeat, leaves no channel for briefings/notification pushes).

### 2026-10-05 · Domain rename: Heartbeat → Greeting

**Background**: "Heartbeat" was a transport-perspective name (the SSE long connection is kept alive by periodic keepalive frames, hence the name), but the domain actually carries business — the entry greeting, the companion's persona copy, and processing-progress phrases; the name pointed readers at the technical layer. The user asked for the rename.
**Trade-off**: greeting over presence — greeting is the domain's main function and reads naturally in Chinese (问候域); presence covers more but is abstract, and progress broadcasting under "Greeting" is acceptable (it shares the same long connection). A full rename rather than internal-only — a personal app, both web clients in the same repo, no third-party consumers, so changing the API path `/api/v1/heartbeat` → `/api/v1/greeting` everywhere at once is cleanest; the SSE event names `greeting`/`chat-progress`, dedup, keepalive, and all other behavior unchanged. The old name "Heartbeat" remains in the cross-cutting ADR (history is not rewritten); full originals live in Git history.
