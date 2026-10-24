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
- A unified message envelope carries every reply: intent, proposal, attachment references, inspect chips; the frontend renders from it.
- Per-domain browsing never regresses: PC activity rail + preview panels; mobile left navigation drawer + three-page pager (notes/chat/board resident).

## Interface

All JSON except attachment upload (multipart, the sole exception to "JSON only"); errors follow the server's standard envelope.

| Method and path                       | Purpose                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/chat/messages`             | Send one sentence; intent routing; returns the message envelope (rate-limited 20/60s/IP) |
| `POST /api/chat/attachments`          | Upload an attachment: image/document whitelist, hard size limits                         |
| `GET /api/chat/attachments/:id`       | Fetch raw attachment bytes (content-addressed, immutable cache)                          |
| `GET /api/chat/sessions`              | Session list                                                                             |
| `POST /api/chat/sessions`             | Create a session                                                                         |
| `GET /api/chat/sessions/:id/messages` | Paged messages (limit + before cursor, paging back in time)                              |
| `DELETE /api/chat/sessions/:id`       | Delete a session (messages cascade in one transaction)                                   |
| `POST /api/chat/messages/:id/outcome` | Report a card's final state (display metadata only)                                      |

## Key rules

- Intent classification outputs an intent plus a self-contained sentence: follow-up fragments are folded before dispatch; corrections about the previous turn re-classify to the corrected domain.
- All AI structured output goes through schema-validated channels (TypeBox tool arguments, or the single-shot `json()` entry for loop-free calls): invalid output is fed back to the model for correction; final failure returns an honest "say that again" reply — never 5xx, never silently dropped.
- The `none` intent goes to the agent: read-only tools, bounded rounds, real data only, honest truncation notices; on failure it falls back to fixed copy.
- Three write triggers: the explicit confirm button, tacit approval by the next message (pending proposals committed oldest-first), and the server's 30-second auto-write; cancel is the only refusal path.
- The user message persists before the AI is called; on AI failure no reply or proposal is produced and the client keeps the input for retry.
- Restored history renders cards in their recorded final states — past proposals carry no confirm buttons.
- Attachments are two-stage: upload for an id, reference it in the message; messages with attachments skip intent classification and go straight to the agent; attachments are one-shot, orphans cleaned after 24 hours; non-whitelist files reject 415, oversized ones 413.
- Read-only tools actually called map deterministically to inspect chips that jump to the matching preview panel; the AI never annotates them.
- The chat domain writes only its own chat.db; cross-domain calls go through injected ports — domain files never import other business domains.
