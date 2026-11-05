# Chat Domain: The Unified Conversational Interface

English | [简体中文](chat.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

The app's single chat box: one sentence in, intent classification routes it — business intents (schedule/ledger/memory/notes/todo) go to the matching domain's proposal pipeline, everything else goes to the agent.

- **Owns**: message and session persistence (`data/chat.db`), intent routing, attachments, card-outcome recording, contextual entry into the preview panels.
- **Does not own**: the domain proposal pipelines themselves (called, never changed), external-world queries (new tools may be registered later), chat-history TTL policy.
- **Invariant**: zero changes to the existing proposal endpoints' paths, actions, status codes, and response shapes.

## Core concepts

- Exactly one ongoing conversation: restored on refresh; no session switching/creation/deletion (the session API exists to recover this one conversation).
- Every reply is an ordered stream of items: pi-ai-shaped transcript messages (user / assistant / toolResult, paired by `toolCallId`) plus toby items — proposal cards, inspect links, notices; attachment references ride on the user message, the routing intent rides as turn metadata beside the stream, and the frontend renders the stream in order.
- Per-domain browsing never regresses: PC activity rail + preview panels; mobile left navigation drawer + three-page pager (notes/chat/board resident).

The shape of one turn — pairing rides on `toolCallId`, provenance on `sourceToolCallId`:

```text
turn metadata      intent = ledger · excerpt (derived, never an item)
────────────────────────────────────────────────────────────────────
message·user        "log lunch ¥30 and show this month's dining total"  (attachment refs ride here)
message·assistant   thinking + ToolCall(c1)
message·toolResult  c1 → ¥1,240            ← paired by toolCallId
message·assistant   ToolCall(c2)
message·toolResult  c2 → ¥360              ← paired by toolCallId
message·assistant   text("proposal drafted…")
proposal_card       proposalId + snapshot · gated: pending → confirmed/cancelled/expired
                                                      · immediate: born confirmed + revertUntil
inspect_link        sourceToolCallId=c1 → preview panel
inspect_link        sourceToolCallId=c2 → preview panel
```

## Interface

All JSON except attachment upload (multipart, the sole exception to "JSON only"); errors follow the server's standard error body.

| Method and path                       | Purpose                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/chat/messages`             | Send one sentence; intent routing; returns the turn's intent and ordered items (rate-limited 20/60s/IP) |
| `POST /api/chat/attachments`          | Upload an attachment: image/document whitelist, hard size limits                                        |
| `GET /api/chat/attachments/:id`       | Fetch raw attachment bytes (content-addressed, immutable cache)                                         |
| `GET /api/chat/sessions`              | Session list                                                                                            |
| `POST /api/chat/sessions`             | Create a session                                                                                        |
| `GET /api/chat/sessions/:id/messages` | Paged messages (limit + before cursor, paging back in time)                                             |
| `DELETE /api/chat/sessions/:id`       | Delete a session (messages cascade in one transaction)                                                  |
| `POST /api/chat/messages/:id/outcome` | Report a card's final state (display metadata only)                                                     |

## Key rules

- Intent classification outputs an intent plus a self-contained sentence: follow-up fragments are folded before dispatch; corrections about the previous turn re-classify to the corrected domain.
- All AI structured output goes through schema-validated channels (Zod tool arguments, or the single-shot `json()` entry for loop-free calls): invalid output is fed back to the model for correction; final failure returns an honest "say that again" reply — never 5xx, never silently dropped.
- The `none` intent goes to the agent: read-only tools, bounded rounds, real data only, honest truncation notices; on failure it falls back to fixed copy.
- Writes are tiered ([write-confirmation-tiers](../decisions/write-confirmation-tiers.md)): additive operations land immediately — the card is born confirmed with a revert window; destructive operations keep the three triggers — explicit confirm button, tacit approval by the next message (pending proposals committed oldest-first), 30-second auto-write — with cancel as the only refusal path.
- The user message persists before the AI is called; on AI failure no reply or proposal is produced and the client keeps the input for retry.
- Item types are a closed union shared by both webs through `@toby/contract` — the pi-ai message kinds plus `proposal_card`, `inspect_link`, `notice`; adding a type is an explicit decision. Message items reuse pi-ai's field names verbatim — zero-translation replay. The session-list preview text (`excerpt`) is a derived, recomputable field, never part of the transcript.
- State lives where its consumer reads it. Transcript state is structural — a tool call without its paired toolResult is honestly "in progress": no orphans, no cleanup. Card state is a field — `proposal_card` carries the kernel's state machine (`pending → confirmed / cancelled / expired`; immediate-tier cards are born confirmed with `revertUntil`). Derived state (`excerpt`, recorded final states) is recomputed or written by the server, never an item of its own.
- Restored history renders cards in their recorded final states — past proposals carry no confirm buttons.
- Attachments are two-stage: upload for an id, reference it in the message; messages with attachments skip intent classification and go straight to the agent; attachments are one-shot, orphans cleaned after 24 hours; non-whitelist files reject 415, oversized ones 413.
- Read-only tools actually called map deterministically to inspect links that jump to the matching preview panel; the AI never annotates them.
- The chat domain writes only its own chat.db; cross-domain calls go through injected ports — domain files never import other business domains.
