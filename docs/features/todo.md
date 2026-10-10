# Todo Domain

English | [简体中文](todo.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: in-domain decision history (domain creation and the check-off/tear-off/direct-write evolution) is in the Decision Records at the end.

## Responsibilities and boundaries

The user says in conversation "remind me to pay the bill at noon" or "this week I need to clean my shoes" and gets a pending todo proposal card (item + due date/time); after review and confirmation (or the 30-second timer), it writes into `data/todo.db`. A sentence naming several things to do splits into multiple todos on one card (since 2026-10-06) — no longer merged into a single title.

- Check off: say "I've paid the bill", "paid the bill and cleaned the shoes", or "all todos are done" to get a check-off proposal card (one item, several items, or a snapshot of all open items); on confirmation the entries flip to `done` (strikethrough for review).
- Tear off: say "delete the pay-the-bill todo", "drop the flight-ticket one" to get a tear-off proposal card (one or several items); on confirmation, physically deleted.
- Review: the preview panel's "Todo board" tab groups by due date (overdue / today / tomorrow / later / undated), expandable to fullscreen; done items collapse to a one-line count by default, expandable for strikethrough review (user decision 2026-10-06, same on PC and mobile; entering batch mode on PC auto-expands — done items join batch cleanup).
- Batch (PC only): the panel's "Batch" multi-select mode works on any items (including done) for "complete selected" / "delete selected" (direct write after a browser confirm dialog, user decision 2026-10-02).
- Single-item direct actions (PC only, the first landing of the dual-app split direction, 2026-10-05): a check-off key at the start of an open item's row (confirm dialog states it cannot be reopened) and a tear-off key at the end (confirm dialog states it cannot be recovered), the same "confirm dialog → direct-write endpoint" discipline as batch.
- Mobile is a pure review view: neither batch nor single-item direct actions ship on mobile (mobile carries no complex operations; writes all go through the companion conversation, user decision 2026-10-05).
- The companion agent can answer "what do I still need to do" via the `list_todos` read-only tool.

**Owns**: the read-only list of `/api/todos*`, one-sentence AI proposals (add single/multiple, check-off and tear-off — single, multiple, all), confirm/cancel, and the batch direct-write endpoints (the board's button path); the intent router's `todo` branch (the conversation's fifth write domain).

**Does not own**: morning briefings and notification pushes; rescheduling, duplicate merging, priorities, subtasks; cross-todo statistics; reopening checked items (done does not go back to open — tear off instead).

## Behavior contract

### Data table

`data/todo.db` (overridable via `TOBY_TODO_DB`), created automatically on first start:

```sql
CREATE TABLE IF NOT EXISTS todos (
  id         TEXT    PRIMARY KEY,
  title      TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  due_date   TEXT,
  due_time   TEXT,
  status     TEXT    NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
```

`status` is `open`/`done`: a confirmed add proposal writes `open`, a confirmed check-off flips to `done` (strikethrough review); tear-off (conversation proposal confirmation or board-button direct write) physically deletes the row.

### API

All JSON; session cookie required when auth is enabled; error envelope follows the server convention `{ error: { code, message } }`:

| Method and path | Request | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/todos` | — | `200 { "todos": [{ id, title, note, due_date, due_time, status, created_at }] }` (with due dates ascending by date, same-day without a time first, undated last) | — |
| `POST /api/todos/proposals` | `{ message, captured_at?, timezone? }` (three-field allowlist) | Add: `200 { proposal_id, expires_at, reply, action: "add", todos: [{ title, note, due_date, due_time }, …] }` (one or more — a sentence with several things splits item by item; entries not yet written carry no `id`, `note` shares the same original sentence); a single-item `reply` includes the due date or "undated", multiple items list titles. Check-off (single/multiple): `200 { …, action: "complete", todos: [{ id, title, note, due_date, due_time }, …] }`, `reply` with the original due date for one, titles for several. Check off all: `200 { …, action: "complete_all", todos: […] }` (snapshot of all open items at drafting). Tear off (single/multiple): `200 { …, action: "remove", todos: […] }`, `reply` uses "tear off" to distinguish from check-off. When check-off/tear-off cannot identify a target or the board has no open items: `200 { proposal_id: null, question }` (follow-up, no proposal); the user speaking to the companion (suggestions/corrections/feedback/questions the AI judges as not-a-task) likewise returns a follow-up (since 2026-10-06) | `400 INVALID_REQUEST`/`INVALID_TEXT`/`TEXT_TOO_LONG`; AI failures `503 AI_*`/`422 INVALID_AI_OUTPUT` |
| `POST /api/todos/proposals/:id/:action` | URL parameters; action only `commit`/`cancel` | commit `200 { status: "committed", id }` (a single add or a single check-off/tear-off returns the `todo_` item id; multi-add and multi/all check-off have no single owner, `id` is null); cancel `200 { status: "canceled" }` | `404` not found or unknown action / `410` expired / `409 PROPOSAL_CANCELLED`, `PROPOSAL_ALREADY_COMMITTED`; GET on proposal paths is always `405` |
| `POST /api/todos/complete` | `{ ids }` (single-field allowlist: non-empty string array, ≤200 after dedup) | `200 { "todos": […] }` (latest full list, same shape as GET) | `400 INVALID_REQUEST`/`INVALID_IDS`/`IDS_TOO_MANY`; any unknown id `404 TODO_NOT_FOUND` (whole batch rolls back); GET `405` |
| `POST /api/todos/remove` | `{ ids }` (same) | `200 { "todos": […] }` (latest full list after deletion) | same |

### Key rules

- The AI first judges "to do" vs "done" (specific items or all), "not wanted anymore" (named tear-off, since 2026-10-02), or "not a task at all" (since 2026-10-06 — suggestions, corrections, feedback, and questions directed at the companion become follow-ups; the sentence itself is never posted as a todo), outputting an `action` field. Adds draft only a title (≤20-character action phrase) and due date; a sentence with several things yields several entries (split per item, never merged into one title, cap 20), a shared date expression attaches to each item it applies to; the note always uses the user's original words (same discipline as the notes domain's "never rewrite the text"; multiple items share the same sentence). Relative dates (today/tomorrow/this Friday…) parse via `captured_at`+`timezone`; `due_time` appears only with an explicit clock time or customary period (noon → 12:00); if no due date can be stated, output `null` (undated) — never guess or pad. When the model occasionally emits the old flat single-item shape, the parsing layer normalizes it into a one-element `items` (the same tolerant discipline as ledger single-entry normalization).
- Multi-add (since 2026-10-06): confirmation writes entries one by one inside a single SQLite transaction via `addMany`; any invalid entry rolls back the whole batch; the "a time requires a date" deterministic cleanup runs per entry.
- Check-off/tear-off (single/multiple): the AI selects target `id`s verbatim from the injected open list (one or more, deduped in-domain); the server deterministically verifies every `id` is in the current open set — anything else is rejected as `INVALID_AI_OUTPUT` (the AI can only pick from the allowlist, never point into thin air). With an empty list or no matching entries, the AI outputs empty targets and the domain turns it into a follow-up (no proposal) — no fabricated check-offs/tear-offs. The line: a thing got done → check off (kept with strikethrough); a thing will not be done / the entry is not wanted → tear off (physically deleted).
- Check off all (`complete_all`): the server snapshots **all** open items at drafting into the proposal — unaffected by the 10-item context cap injected into the AI, and todos added after drafting are never swept in by this confirmation; an empty board returns a follow-up. Confirmation flips the batch in one SQLite transaction; any anomaly rolls back everything.
- A time requires a date: when the AI outputs a time without a date, in-domain deterministic cleanup blanks the time.
- AI output passes local format and calendar validation (`2026-02-30` rejected) before entering a proposal; drafting injects the latest 10 open items (with ids) for name alignment — if the same thing is already on the board, a new add still produces a new proposal (no merging); the user decides while reviewing.
- Proposal TTL is 10 minutes, matching the other domains; commit is idempotent (repeated confirmation returns the first associated id, no duplicate writes; repeated check-off flips are likewise idempotent); cancellation is the only refusal. A proposal shown 30 seconds without cancellation is auto-committed by the server (user decision, 2026-10-05), via the same commit path as manual confirmation.
- Batch and single-item direct-write endpoints (board button path, user decision 2026-10-02; PC single items added 2026-10-05): web (PC) "Batch" multi-select or inline single action → browser confirm dialog → `POST /api/todos/complete|remove`, following the memory-list-delete "explicit selection + client confirm dialog + direct write" discipline, bypassing proposals; both endpoints process items in one SQLite transaction — any unknown id is a 404 with full rollback (no half-batch effects); the response carries the latest full list for in-place refresh. Tear-off is irreversible and check-off cannot be reopened — the confirm dialogs say so. Mobile never calls the direct-write endpoints (pure review).
- Intent boundaries: "remind me" of a one-off concrete thing → todo; "always remind me…" of long-term habit constraints → memory; continuous daily check-ins → schedule; thoughts/goals/moods → notes; reporting one-off things done (including all done) and deleting unwanted todos → todo. Boundary precedents live in the intent classifier's prompt.

### Exceptions and edges

- **Undated todos**: entries with `due_date` null sort last; the proposal card and panel honestly mark "undated" — no fabricated dates.
- **Check-off target not found**: no matching entry on the board (or no open items when checking all off) returns a follow-up, not a proposal; an AI-named `id` outside the open set is rejected as `422 INVALID_AI_OUTPUT`. Repeated check-off is idempotent (confirming an already-`done` item does not error); batch check-off/tear-off runs in one transaction — any unknown item rolls back everything.
- **Proposal expiry**: after the TTL, commit/cancel returns `410 PROPOSAL_EXPIRED`; the web disables the confirm button when the countdown hits zero.
- **Concurrency**: in-memory proposal storage with single-process semantics — the server is the only writing process; confirmed writes serialize through synchronous SQLite transactions.
- **Permissions**: all `/api/todos*` sit inside the auth scope; unauthenticated access gets 401 from the global auth guard.
- **Empty database**: `todos` returns an empty array; the web shows the empty state and nudges toward saying "remind me…" in the conversation.

## Security boundaries

The AI produces only todo content fields (title / due date / due time) and `id`s from within the open list (check-off/tear-off targets can only be picked from the injected allowlist; check-off-all outputs only the action marker with the target set snapshotted by the server and re-verified); it never touches database paths or write capability. Conversation proposals confirm/cancel with the `proposal_id` only (URL path) — never titles, dates, or anything beyond the contract. The batch direct-write endpoints accept only the `ids` explicitly selected by the user on the board (button path, the memory-list-delete discipline — "explicit selection + client confirm dialog + direct write"). `data/todo.db` is written only by the server.

## Acceptance

Automated and passing (storage including single/batch check-off flips, batch tear-off rollback and `addMany` multi-entry transactional writes; proposal service unit tests for add single/multiple and every check-off/tear-off shape; HTTP integration for the add single/multiple/check-off/tear-off full chains and the follow-up shape; direct-write endpoint contract edges and the 405 surface; intent enumeration; web proposal cards including multi-add (count and titles, shared original sentence once, per-entry due dates) with historical single-entry compatibility, check-off/tear-off shapes, and board batch-mode interaction (select / confirm dialog / direct write / refresh clears selection / empty board hides the entrance) — see the tests); real-AI blind testing ("remind me to pay at noon" → proposal card → confirm → board review; "buy cat food and rice tomorrow" → one multi-entry add card → confirm → two entries on the board; "I paid the bill", "paid the bill and cleaned the shoes", "all done" → check-off card → confirm → strikethrough review; "delete the pay-the-bill todo" → tear-off card → confirm → entry gone; panel "Batch" select → complete/delete selected) awaits user review.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-09-20 · Todo board minimal version (three later revisions)

**Background**: the user said "remind me to pay the bill at noon" and received a fake proposal "drafted" as plain text by the companion agent — no confirm button. Root cause: one-off, deadline-carrying todos fit none of the four domains (schedule check-ins / ledger / memory / notes), and the intent classifier had nowhere to route them; the companion-notes draft had long planned a "todo board" domain (todos/memos — one-off, with deadline and completion state), and its precedent table had ruled "this week I need to clean my shoes" into the board.
**Trade-off**: an independent `todo.db` and fifth intent/proposal domain — todos are consumed by querying and flipping state, which per the draft's grand principle belongs in SQL, distinct from the schedule tracker's "record what happened" model; the proposal lifecycle copied the existing domains — unified envelope, implicit confirmation, and proposal cards "confirm-to-view" all came free at minimal marginal cost; the AI drafts only title and due date, the note always uses the user's original words (same discipline as notes' "never rewrite"), and failed due-date parsing lands as undated rather than rejection so a sentence is never dead-ended. **Later evolution**: 09-26 completion check-off (the AI names entries from the injected open list — one, several, or a snapshot of all); 10-02 tearing off notes (a `remove` proposal with the same naming discipline as check-off) and panel batch direct write (the "explicit selection + confirm dialog + direct write" discipline — this domain's first non-proposal write path, the same exception as memory list deletion); 10-05 the dual-app fork — PC gained single-item check-off/tear-off direct actions, mobile dropped batch for pure review (the first landing of the dual-app split direction, see the "splitting the web into dual apps" ADR revision record).

### 2026-10-06 · Multiple adds in one sentence

**Background**: the user said "tomorrow I need to buy cat food, buy rice, change the bedding, and clean up" and the four things were merged into one title "buy cat food, rice, bedding, cleanup" and written; follow-ups like "you should split that into several todos" and a re-send listing "add several todos: 1. … 4. …" still produced a single-entry card — user feedback said multi-add was unsupported (live conversation test, 2026-10-06).
**Trade-off**: the add protocol changed from single entry to an item array — the AI outputs `items` (several things split item by item, each parsing its own due date, shared dates attached per item, cap 20), the proposal payload is an `entries` array, and confirmation batch-writes via `addMany` in one transaction (any invalid entry rolls back all); the response and proposal card unified into a `todos` array (same shape as check-off/tear-off; newly added entries carry no `id` before writing, multi-entry commit has no single owner so `id` is null, matching multi check-off); when the model occasionally emits the old flat single shape, the parsing layer normalizes (the same tolerance as ledger single-entry normalization), and the web renders historical messages with the old single `todo` compatibility (the same as the ledger `transactions` migration). Rejected: the frontend re-splitting merged titles — once merged, each item's due-date information is lost and cannot be recovered; forcing one thing per message — saying several things in one sentence is the norm, and splitting send count is a regression.

### 2026-10-06 · "Not a task" becomes a follow-up (question 3b)

**Background**: the user said "you should split that into several todos"; the todo AI's rule was "all remaining todo requests are handled as add", so this sentence spoken to the companion was posted verbatim onto the board as a todo (title: split this todo into several todos; later manually cancelled). Root cause: the judging protocol had only add/complete/remove — no exit for "this sentence is not about a task at all".
**Trade-off**: a fourth shape `{"action": "none", "question": …}` — when the AI recognizes the user speaking to the companion (suggestions, corrections, feedback, questions) it outputs a follow-up; the service layer turns it into `{ proposal_id: null, question }`, no proposal, nothing written (the same exit as check-off/tear-off target-not-found follow-ups); the boundary went into the prompt: the user stating a thing to do / done / not wanted → the matching action; evaluating, directing, or questioning the companion → none. Together with the same-day 2d/2e precedents in the intent classifier ("note this" + a task/fix request → todo; correcting the previous turn re-routes through the corrected domain), this closed the loop. Rejected: giving the todo domain a real "split" action — after multi-add landed, the splitting scenario essentially vanished; a protocol branch for a vanished scenario is not worth it.
