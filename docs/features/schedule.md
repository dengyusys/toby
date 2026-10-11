# Schedule Domain

English | [简体中文](schedule.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Natural language in the chat becomes a constrained, verifiable schedule-modification proposal; field-level old/new values shown; nothing writes until confirmation (explicit button / tacit approval by the next message / the 30-second deadline, whichever comes first).

- Schedule content rides on **trackers**: nothing preinstalled, no built-in categories — what to track is created by the user through conversation (proposal-based); definitions are data, so adding or adjusting fields needs no code change.
- **Owns**: tracker create/archive/amend (proposal-based), read queries, proposal generation and confirmation, AI parsing and validation, conflict detection and transactions.
- **Does not own**: frequency/deadline rule engines, cross-tracker statistics (the companion agent's job), renaming slugs, retyping or deleting fields or history, offline queues and undo.

## Core concepts

- A tracker = slug + name + fields (boolean/number/enum/text/time); a cap on simultaneously active trackers.
- Months derive from records: a month with no records does not exist; the first write creates it.
- Negation only sets boolean `false`: parsing is stateless — old values are never auto-cleared by a command.

## Interface

All JSON; errors follow the server's standard envelope.

| Method and path                           | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `GET /api/schedule/months`                | Months that have records                               |
| `GET /api/schedule/trackers`              | Tracker definitions (including archived)               |
| `GET /api/schedule/records?month=YYYY-MM` | Month records (tracker-native shape)                   |
| `POST /api/schedule/commands/text`        | One sentence → proposal (rate window shared with chat) |
| `POST /api/schedule/proposals/:id/commit` | Confirm the write (idempotent)                         |
| `POST /api/schedule/proposals/:id/cancel` | Cancel the proposal                                    |

## Key rules

- The AI receives only the command text, capture time, timezone, and a schema generated from the active trackers; never schedule content, paths, keys, or tools.
- Output passes schema/date/tracker/field/enum validation before becoming a proposal; undefined fields and out-of-enum values are deterministically rejected into a follow-up question.
- Tracker amendments may only add or disable fields, keeping at least one active; disabling is a definition flag — historical data is kept as-is.
- Reads are tolerant, writes are strict: historical unregistered enum values still display; writes always validate against the current definition.
- Commit re-reads target fields inside a transaction, compares against the proposal's expectation, then writes through a serial queue; any mismatch rejects the whole proposal with zero changes.
- Four proposal actions: field writes, create tracker, archive tracker, amend tracker; TTL 10 minutes, auto-write after 30 seconds uncancelled (same commit path).

## Acceptance highlights

- Four zero-write states: unconfirmed, cancelled, expired, and ambiguity follow-ups change nothing; repeat confirmation is idempotent; field conflicts reject the whole transaction; unrelated fields are preserved.
- Cold start entirely by conversation: create trackers (with enum fields) → record continuously → archive, no code changes; AI output stays within definitions.
- Real AI calls go through manual verification, not automated tests.
