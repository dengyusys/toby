# Notes Domain

English | [简体中文](notes.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Passing thoughts, resolutions, and memos said in the chat become Markdown notes under `data/notes/` after proposal confirmation — a "flip through the notebook" experience, openable in any editor.

- **Dual-track storage**: a monthly journal (`YYYY-MM.md`, day sections + paragraph-block notes, written by the system) and topic notebooks (any non-monthly `.md`; the filename is the topic — collections the owner maintains by hand; the system only does named continuation and opening new notebooks).
- One note = one passage of the owner's original words; no title line, no type word, no classification.
- **Does not own**: rewriting/deleting/merging topic notebooks (owner-edited content the AI never touches), automatic topic classification (named only), index views, direct PC editing (a dual-app split candidate).

## Core concepts

- One monthly file per month, notes grouped into day sections; existing topic files are recognized as-is, zero migration.
- A topic notebook's identifier is its filename; its display name is the first `# heading` inside (falling back to the filename).
- Seven operation primitives: monthly add/append/rewrite/remove/merge + topic new/append.

## Interface

All JSON; errors follow the server's standard envelope.

| Method and path                                   | Purpose                                              |
| ------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/notes/months`                           | Monthly file list (newest first)                     |
| `GET /api/notes?month=YYYY-MM`                    | Monthly file content; `exists: false` when absent    |
| `GET /api/notes/topics`                           | Topic notebook list                                  |
| `GET /api/notes/topic?name=X`                     | Topic content (topic name only, never a file path)   |
| `POST /api/notes/proposals`                       | One sentence → note proposal (one of the primitives) |
| `POST /api/notes/proposals/:id/commit` · `cancel` | Confirm / cancel                                     |

## Key rules

- Anchored operations (append/rewrite/remove/merge) identify targets by "recent notes + numbered list + excerpts"; out-of-range numbers are treated as hallucination and degrade to a fresh add with a trace — a wrong merge hurts more than an extra note.
- Rewrite/remove/merge snapshot the target at proposal time and re-read the file before commit; any mismatch voids the proposal — external edits win, the server never overwrites the owner's hand edits.
- Add and append always keep the owner's original words; rewrite's replacement text is AI-generated per instruction and lands through a "before → after" review card.
- Topic naming has no failure path: a list hit → append to that notebook; a miss → open a new one (the card says "new"); an illegal AI-proposed name → degrade to a monthly add with a trace.
- Server-side validation of new topic names (length, path separators, leading dot, monthly-name squatting) doubles as the only path-traversal defense.
- Intent boundaries: writing note content → this domain; viewing/summarizing/reviewing → the companion's read-only tools.
- Proposal TTL 10 minutes; uncancelled after 30 seconds the server auto-writes, same path as manual confirmation.

## Acceptance highlights

- Seven-operation dispatch and out-of-range degradation; snapshot conflict rejection; topic naming's four shapes (hit / miss / illegal name / existing notebook).
- Path hardening: separators, `..`, overlong names, monthly-name squatting all rejected.
- Read contract: absent files return `exists: false` rather than 404; overlong notebooks truncate with a marker.
