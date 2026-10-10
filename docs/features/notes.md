# Notes Domain

English | [简体中文](notes.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: in-domain decision history (operation framework, dual-track storage) is in the Decision Records at the end; home-assignment and boundary precedents are in the companion-notes draft.
> Note: this domain previously had no feature doc; contracts are documented here for the first time (2026-10-05) — they were previously scattered across two ADRs and the architecture doc's domain table.

## Responsibilities and boundaries

Thoughts, resolutions, and memos the user says offhandedly become Markdown notes under `data/notes/` via proposal confirmation — a "flip through a notebook" experience, openable in any editor.

- **Dual-track storage**: a monthly journal (`YYYY-MM.md`, day sections + paragraph-block notes, written by the system) and topic notebooks (any non-monthly `.md`; the filename is the topic — collections the owner maintains by hand; the system only does named continuation and opening new notebooks).
- One note = one passage of the owner's original words; no title line, no type word, no classification (the no-title decision, 2026-09-27).

**Owns**: the `/api/notes*` read surface (month list, month file verbatim, topic list and verbatim) and the proposal surface (generation/confirmation/cancellation of the seven operation primitives); AI judgment (op selection, topic naming); companion read-only tools (recent notes, topic list and full text).

**Does not own**: rewriting/deleting/merging topic notebooks (owner hand-edited content the AI leaves alone — a separate future decision); AI auto-assigning topics by content (named only); writing summaries back into notes (summaries are conversation replies — the companion's job); directory/index views; direct PC editing of notes (a dual-app split candidate).

## Behavior contract

### Storage

- Only the server writes `data/notes/`; one file per month, notes grouped into day sections.
- Topic notebooks: any `.md` not named `YYYY-MM` (dot-prefixed ignored); the filename (sans extension) is the topic identifier, the first `# title` line inside is the display name (falling back to the filename); existing files need zero migration and are recognized natively.
- New topic names are validated server-side: 1–30 characters, no path separators or control characters, no `YYYY-MM` shape squatting on monthly names, no dot prefix or `..` — this validation is simultaneously the only defense against path traversal (the topic name is joined directly into a file path).

### API

All JSON; session cookie required when auth is enabled; error envelope `{ error: { code, message } }`:

| Method and path | Request | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/notes/months` | — | `200 { months: string[] }` descending | — |
| `GET /api/notes?month=YYYY-MM` | month query parameter | `200 { month, exists, markdown }` (missing month file → `exists: false`, `markdown: ""`, not 404) | `400 INVALID_MONTH` missing parameter |
| `GET /api/notes/topics` | — | `200 { topics: [{ name, title }] }` ascending by name | — |
| `GET /api/notes/topic?name=X` | name query parameter (topic name only, never a file path — the server maps the file) | `200 { name, title, exists, markdown }` (missing → `exists: false`, not 404) | `400 INVALID_TOPIC_NAME` missing; illegal name 400 |
| `POST /api/notes/proposals` | `{ message, captured_at?, timezone? }` (key allowlist; extra keys 400) | `200` note proposal (payload below) | `400 INVALID_REQUEST/INVALID_TEXT`; `400 TEXT_TOO_LONG` (message > 2000 characters); AI failures `503 AI_*`, `504 AI_TIMEOUT`, `422` invalid output |
| `POST /api/notes/proposals/:id/commit` \| `/cancel` | empty body | `200 { status, … }` (monthly ops carry the target month; topic ops `{ status, topic }`) | lifecycle kernel shared with all domains: `404` not found / `410` expired / `409` cancelled or committed idempotently |

Proposal payload (the `proposal.payload` of the conversation's unified envelope; absent operation fields are null; five monthly primitives + two topic primitives):

- `entry` (`add`, new note, `{ date, body }`), `append_to` (`append`, continuation, target named by a body excerpt), `rewrite` (replacement, old → new diff), `remove` (delete one), `merge` (several into one — the earliest survives, the rest deleted);
- `new_topic` (`add_topic`, open a notebook, `{ name, body }`), `topic_append` (`append_topic`, named continuation, `{ name, body }`);
- field details are defined by `apps/server/src/domains/notes/` and the root HTTP integration tests.

### Key rules

- **Operation primitive registry**: what the AI can do to notes converges to seven operations (monthly add/append/rewrite/remove/merge + topic append_topic/add_topic); the operation catalog (prompt fragments), validation mapping, and commit dispatch align in three tables in `operations.ts` — adding an operation = one row in each.
- **Numbered selection + deterministic re-check**: the context for continuation/rewrite/delete/merge is "latest 10 notes (across months) + numbered list + body excerpts"; the AI names targets by number, the server verifies the number falls inside the list — out of range counts as hallucination, degrading to a fresh note with a trace (a wrong merge hurts more than one extra note; dead-ending the sentence is the new harm).
- **Snapshot validation (anchored operations)**: rewrite/remove/merge record a snapshot of target entries at proposal generation; before commit the file is re-read and compared — a mismatch is `409 NOTE_CONFLICT`, the proposal voided and regenerated. External edits win; the server never overwrites the owner's hand edits. add/append are pure appends with no conflict surface.
- **Original-words discipline**: new notes and continuations always use the owner's original words; a rewrite's replacement body is generated by the AI per the owner's instruction and takes effect through a review card (before → after).
- **Topic naming judgment (no failure path)**: hit on the list (exact match of filename or display name) → continue the existing notebook; no hit → open a new one (the card says "new" — typos are caught at review); an illegal AI-provided name → degrade to a monthly note with a trace (the message content must not be lost); the wanted notebook already exists → fall into it. commit has no 404/409 failure path (barring the extreme timing of external file deletion).
- **Intent boundaries**: writing note content → `notes`; viewing/summarizing/reviewing notes → `none` (the companion answers via the `get_recent_notes` read-only tool, latest 20 across months); "into the X notebook" / "start a new topic" → `notes`.
- Proposal TTL is 10 minutes, matching every domain; confirmation submits only the `proposal_id` from the URL. A proposal shown 30 seconds without cancellation is auto-committed by the server (user decision, 2026-10-05), via the same commit path as manual confirmation.

### Exceptions and edges

- `message` empty or non-string `400 INVALID_TEXT`; over 2000 characters `400 TEXT_TOO_LONG`.
- Illegal AI judgment output (non-JSON / outside the op enum) is `422` only after tolerant extraction and one retry; the outward error semantics match every domain.
- A missing month file or notebook is not 404 — `exists: false` renders the empty state; when the companion reads an over-long notebook it truncates at 6000 characters with a `truncated` marker, stated honestly.
- Old entries in historical formats (once carrying title lines) stay verbatim and remain targetable by anchored operations.

## Security boundaries

- Required: every write goes "generate proposal → user review → confirm with the `proposal_id` in the URL"; confirmation may be the implicit confirm of sending the next message.
- Forbidden: AI or web directly reading/writing `data/notes/`; clients submitting file paths (topic names only) or anything beyond the contract.
- Forbidden: notes tests touching the real `data/notes/` — proposal and storage tests must use temporary data directories.

## Acceptance

- Automated (passing; see storage and proposal-service unit tests in `apps/server/test/`, root HTTP integration tests, and rendering tests in `apps/web/test/`): seven-op dispatch and out-of-range degradation, snapshot conflict rejection, the four topic-naming shapes, path hardening (separators / `..` / overlong / `YYYY-MM` shape → 400), read-surface contracts, web proposal cards (including rewrite diffs, open-new/continue) and the "months | topics" switch — all using temporary data directories, never calling real AI.
- Read-only smoke on real data (verified 2026-10-05, records in Git history): ten topic notebooks listed at once (Chinese titles taken from `#` headings), the `razors` notebook read back verbatim, the monthly surface unchanged, path traversal 400.
- Real-AI blind testing (same topic said several times merged into one, named continuation, opening a notebook, rewrite diffs) awaits user review.

## Open questions

- Direct PC editing of notes (first candidate of the dual-app split direction; writes still through server endpoints).
- Rewriting/deleting/merging topic notebooks (owner hand-edited content; a separate future decision).

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-09-27 · Notes operation framework (two same-day revisions: remove/merge; no-title)

**Background**: one topic said across several turns became several notes — a "continuation" mechanism existed but the chain almost always fell into new-note territory (the AI saw only the latest 5 entries' dates + titles, the prompt leaned "when unsure, null", and continuation required character-exact title matching); the user pointed out the essence was structural — wanting to edit one note, summarize, or get an index each meant adding code across the whole chain.
**Trade-off**: the write side converged to an **operation primitive set driven by a registry** (three aligned tables — catalog, validation mapping, commit dispatch; a new operation = one row in each, ending "every feature paves code through the chain"); **numbered selection** replaced title copying (echoing a number beats character-exact copying; out-of-range counts as hallucination, degrading to a fresh note with a trace rather than dead-ending); `rewrite` was this domain's first non-append write, carrying **snapshot validation** — notes' selling point is "any editor can open it, the owner can hand-edit", so a server that rewrites must promise never to overwrite hand edits; snapshot at generation and compare at confirmation is the cheapest optimistic lock under the proposal system; summaries went to the companion's read-only tool instead of the write path (summaries are consumed as conversation replies; stored digests expire and contradict "the file is the truth"). Same-day revision one: added `remove`/`merge` ("notes are never cleaned" revised to "deletion may be AI-proposed, review-gated"; cross-month operations validate everything before writing). Same-day revision two (no-title): notes keep only the original-word paragraph blocks; title lines and type words retired, classification cancelled outright, target naming unified to body excerpts.

### 2026-10-05 · Dual-track notes storage (monthly journal + topic notebooks)

**Background**: `data/notes/` actually held two kinds of files — the system-written monthly journal and ten topic files the owner had placed by hand (razors, Munger-thinking etc., free structures of `# title` + sections + tables), the latter completely invisible to the system (the list only recognized monthly names; the web couldn't see them; the companion didn't know they existed); the user asked for notes to support both date-based and topic-based filenames.
**Trade-off**: any non-monthly `.md` is a topic notebook — filename is the topic, first `#` is the display name, the existing ten migrate zero; write depth chosen as "named continuation + open new topic" — topic notebooks are owner-maintained collections, so no entry-level rewrite/delete/merge (too risky); the landing is **named-only** — the AI never auto-assigns topics by content (mis-assignment is worse than no assignment); topic-name validation doubles as the only path-traversal defense; the naming judgment converged to a no-failure path (hit → continue; no hit → open new; illegal name → degrade to monthly with a trace; already exists → fall in); the companion gained two read-only tools (list topics, read one in full, truncating at 6000 characters with an honest marker).
