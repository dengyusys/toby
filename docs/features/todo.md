# Todo Domain

English | [简体中文](todo.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

A one-shot todo board: one sentence in the chat, a proposal card confirmed, then a write into the todo database (`data/todo.db` on SQLite; MySQL schema `toby_todo`).

- **Owns**: adding (one sentence, single or multiple items), checking off (done), tearing off (not wanted), and reviewing by due date.
- **Does not own**: recurring routines (schedule), long-term preferences (memory), thoughts and moods (notes); rescheduling, priorities, subtasks, reopening a checked item.

## Core concepts

- A todo = title (≤20-character action phrase) + note (the user's original words) + due date/time (optional — undated) + status `open`/`done`.
- A sentence naming several things splits into several todos on one proposal card; never merged into one title.
- Only the server writes the database; the agent can read the board through a read-only tool.

## Interface

All JSON; errors follow the server's standard envelope. Response shapes and error codes are defined by code and tests when the domain lands.

| Method and path                        | Purpose                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/todos`                       | Full list, ordered by due date, undated last                                                                                        |
| `POST /api/todos/proposals`            | One sentence → proposal: add / check off / tear off / check off all; unresolvable targets or not-a-task become a follow-up question |
| `POST /api/todos/proposals/:id/commit` | Confirm the write (idempotent)                                                                                                      |
| `POST /api/todos/proposals/:id/cancel` | Cancel the proposal                                                                                                                 |
| `POST /api/todos/complete`             | Board direct write: check off selected (PC only)                                                                                    |
| `POST /api/todos/remove`               | Board direct write: tear off selected (PC only)                                                                                     |

## Key rules

- The AI drafts only title and due date; the note always keeps the user's original words.
- Check-off/tear-off targets can only be picked from the open list injected by the server, re-verified server-side.
- No due date expressible → undated; never guess. A time always requires a date.
- Multi-item writes share one database transaction; one invalid entry rolls back the batch.
- Check-off-all snapshots the open set at drafting time; todos added later are not swept in.
- Proposal TTL is 10 minutes; uncancelled after 30 seconds the server auto-writes — same path as manual confirmation, idempotent; cancelled proposals refuse commit, expired ones answer 410.
- Board direct writes are PC-only "explicit selection + confirm dialog", bypassing proposals; any unknown id rolls back the whole batch; tear-off is irreversible; mobile is review-only.
- Intent boundaries: "remind me…" (one-shot) → this domain; "from now on always…" → memory; daily check-ins → schedule; thoughts and moods → notes.
