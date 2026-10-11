# Greeting Domain

English | [简体中文](greeting.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Every time the user opens or refreshes the page, the companion offers a greeting (AI-generated, time-of-day fixed copy as fallback); the greeting is shown for that visit only and never written to any database.

- The same SSE connection also carries conversation-progress broadcasts: while waiting for a reply, the waiting line shows the real stage ("understanding your words", "checking the schedule", …).
- **Does not own**: opening briefings, todo reminders, or other pushes (long-term candidates), two-way communication, greeting persistence and history, multi-user presence.

## Core concepts

- The SSE stream has three frame kinds: greeting (on connect, before any keep-alive), progress (broadcast as conversation processing advances, best-effort), and comment keep-alive (every 25 seconds).
- Progress phrases are broadcast deterministically by the server along the processing path — never AI-generated; the web pins them on arrival, falls back to local rotating copy when the channel is unavailable, and clears on reply.

## Interface

| Method and path         | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/greeting?tz=` | SSE event stream; tz is an IANA timezone, defaulting to UTC when missing or invalid |

## Key rules

- The greeting **never fails to arrive**: no AI key, call failure, timeout, or invalid output falls back to time-of-day fixed copy; the service never throws outward.
- The greeting addresses the user as 「先生」 — the AI prompt and the fallback copy follow the same discipline.
- A 30-second dedup window (keyed by a session-token digest) blocks duplicate greetings from reconnects and dev-mode double mounts; after expiry a new connection is greeted again.
- Greetings **are never stored**: the web appends them as a local-prefixed assistant message, gone on refresh, never entering the chat database or intent routing.
- The web connects to the greeting channel only after session history finishes restoring, so the greeting is never overwritten by it; connection errors close silently without auto-reconnect.
- Progress broadcasts go to all online connections; no connections means silent drops, and push failure never disturbs conversation processing.

## Acceptance highlights

- Greeting service: time-of-day fallback, AI output cleanup, failure fallback, never throwing.
- Stream contract: response headers, greeting-frame ordering, the dedup window and its expiry, 401/405.
- Progress frames: broadcast ordering across processing stages, silence on disconnect; the web pinning real stages and rotating fallbacks.
