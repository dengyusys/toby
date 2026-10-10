# Schedule Domain

English | [简体中文](schedule.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: "all daily schedule operations go through the server"; "schedule trackers are fully user-defined"; in-domain decision history (data source, tracker-first remodel, extraction-rule ownership, migration baseline) is in the Decision Records at the end.

## Responsibilities and boundaries

Turn natural language into restricted, verifiable schedule-modification proposals; show the date, tracker, old value, and new value for every target field; write schedule data only after the user reviews and confirms (explicit confirm, tacit approval by sending the next message, or the 30-second timer expiring — any of the three).

- Schedule content is carried by **trackers**: the system pre-installs none and has no built-in categories — what to track is created by the user through conversation (proposal-based), and all trackers share one model and one pipeline.
- Tracker definitions (names, fields, enums) are data: creating, archiving, and adjusting fields requires no code changes.

**Owns**:

- Creating, archiving, and field-adjusting tracker definitions (proposal-based).
- Read-only month/records/definitions APIs for all trackers, plus proposal generate/confirm/cancel APIs.
- AI structured parsing (schema generated dynamically from active tracker definitions; with no active trackers the operation set is empty and creating a tracker is the only write path), disambiguation follow-ups, field validation.
- Conflict detection, serialized commits, month creation, SQLite transaction rollback, and idempotent confirmation.

**Does not own**: AI directly reading or writing schedule data, accessing database paths, or executing a shell; any automated submit bypassing the proposal flow (the 30-second auto-commit goes through the proposal commit path and is not an exception); offline write queues, user action history, or undo; deleting an entire day's record; renaming trackers or changing slugs, changing field types, deleting fields or historical data (amend can only add and disable fields); multi-select enum / counter / rating field types; frequency and duration rule engines; cross-tracker linkage and cross-tracker statistics (querying belongs to the companion agent).

## Behavior contract

### Interfaces and compatibility promises

The table below defines the public API compatibility promises. The server implements the routes; the web apps maintain their consumption paths in their own API clients; root HTTP integration tests verify the two agree:

| Operation | Path | Client input |
| --- | --- | --- |
| Month list | `GET /api/months` | none |
| Tracker definitions | `GET /api/trackers` | none (returns all including archived, by creation order) |
| Month records | `GET /api/records?month=YYYY-MM` | month query parameter |
| Generate proposal | `POST /api/v1/commands/text` | `{ text, captured_at, timezone }` |
| Confirm proposal | `POST /api/v1/proposals/{proposal_id}/commit` | empty body |
| Cancel proposal | `POST /api/v1/proposals/{proposal_id}/cancel` | empty body |

- `GET /api/trackers` returns `{ trackers: [{ slug, name, status: "active" \| "archived", fields: [{ key, label, type, enumValues?, unit?, status: "active" \| "disabled"? }], createdAt, archivedAt? }] }`; field `type` is one of `boolean` / `number` / `enum` / `text` / `time` (decision "tracker-first schedule domain"); `status: "disabled"` marks a disabled field (historical data kept, no longer recorded).
- `GET /api/records` returns the tracker-native shape: `days` keyed by `YYYY-MM-DD`, each value `{ [tracker_slug]: { [field_key]: value } }`; a tracker with no records that month occupies no key.
- The server's exact status codes, error text, and response structure are defined by `apps/server/src/infrastructure/http/contract.ts`. Error responses of all APIs (read-only and v1 proposals/auth/memory) are uniformly `{ "error": { "code", "message" } }`.

### Proposal lifecycle

- A proposal carries `proposal_id`, an expiry time, and server-held operations; the client cannot submit or modify operations.
- Confirm and cancel use only the `proposal_id` in the URL. Repeated confirmation returns the saved result without writing again; a cancelled or expired proposal cannot be confirmed again.
- Proposal TTL is 10 minutes.
- A proposal shown for 30 seconds without cancellation is auto-committed by the server (user decision, 2026-10-05): same commit path as manual confirmation, idempotent, with no exemption from conflict detection; cancellation is the only way to refuse, within the 30-second window.
- Four proposal action kinds: field writes (current), `create_tracker` (name + field definitions), `archive_tracker`, `amend_tracker` (add/disable fields only); creating/archiving/adjusting trackers likewise confirms by `proposal_id` alone.

### Key rules

- The AI receives only the instruction text, capture time, timezone, and a strict output schema; the schema and prompt field list are generated dynamically from all active tracker definitions (with no active trackers, the operation set is empty); the AI receives no schedule contents, database paths, secrets, shell, or executable tools.
- AI output must pass JSON/schema validation and date/tracker/field/enum validation before a proposal is generated; undefined fields and out-of-enum values are deterministically rejected and turned into follow-up questions. Negation semantics only set boolean `false`: parsing is stateless, old details recorded earlier are not automatically cleared by an instruction (an explicit "clear X" produces an unset).
- Tracker definition rules: slug and name are unique (the creation proposal rejects conflicts at the validation layer with the conflicting name in the message); slug and field keys cannot be reserved words (e.g. `calendar` — the month view "all" key); a single-select enum has at least two values; at most 12 concurrently active trackers — archive first beyond that.
- Amend rules: only adding fields (the new key must not collide with any existing field) and disabling fields (the key must be a currently active field; at least one active field must remain) are allowed; renaming, slug changes, field-type changes, and data deletion are forbidden. Disabling is a definition flag: historical values stay as-is, reads display them tolerantly with their original semantics, and daily recording plus AI prompts include only non-disabled fields.
- Reads are tolerant, writes are strict: historical data with unregistered enum values displays as-is without error; writes always validate against the current definitions.
- On commit, target fields are re-read inside a SQLite `BEGIN IMMEDIATE` transaction and compared against the proposal's expected state, then written through an in-process serialized queue; any step failing rolls back the whole thing.
- Writes are field-level: unrelated fields are preserved; only target fields are modified or removed.
- Archiving a tracker: daily-write prompts exclude archived trackers, related instructions take the "unrecognized → follow-up" path; archiving deletes no data — the month view collapses it, history stays queryable (day details show when that day has data).
- User path: type natural language in the chat page → intent routing enters the schedule path → missing information returns a disambiguation follow-up (no proposal created) → review the diff on the in-message proposal card → confirm or cancel. No cancellation, expiry, AI failure, or validation failure may ever write schedule data.
- All trackers share one table set (decision "tracker-first schedule domain"); migrations run through a sequential migration table — a failure records no version; `pnpm run validate` is the post-migration gate.

### Exceptions and edges

- Empty text, oversized text, non-JSON, extra request fields, or wrong methods are rejected before any AI call.
- Months derive from entries (third revision of "tracker-first schedule domain"): when the target month has no entries, the proposal flags month creation; the first committed write creates the month — a month without records does not exist (reads return 404 MONTH_NOT_FOUND).
- If current fields differ from proposal-generation time, the entire proposal conflicts and no database change occurs.
- AI timeout, rate limiting, or unavailability returns a sanitized error that leaks no upstream response or secrets.
- When Memory is unavailable, context and summary writes are skipped without blocking the schedule flow.
- Explicit `false`, numeric `0`, empty arrays, and missing fields must each be displayed and compared distinctly.
- Field-type mismatch (a count filled with "a lot"): deterministic validation rejects it and turns into a clarifying follow-up.

## Security boundaries

- Required: every write goes "generate proposal → user review → confirm with the `proposal_id` in the URL"; confirmation may be an explicit click or the implicit confirm of sending the next message; "cancel" is the only refusal path. Tracker creation, archiving, and adjustment likewise go through proposal confirmation.
- Forbidden: AI or web directly reading/writing `data/schedule.db`; clients submitting operations, file paths, or anything beyond the contract; users or AI inventing fields outside tracker definitions.
- Forbidden: write tests touching the production schedule database — proposal-API write tests must use a temporary SQLite data directory.

## Acceptance

- Unconfirmed, cancelled, expired, and disambiguation follow-ups modify no schedule data; repeated confirmation does not double-write; field conflict rejects the whole transaction; on update, unrelated fields are preserved and target fields replaced or removed; an injected multi-category failure rolls back to the complete pre-commit domain state (covered by automated tests — see `apps/server/test/` and the root HTTP integration tests).
- Empty-database start: no pre-installed trackers; create (including enum fields) → record across days → archive, entirely via natural language and proposal confirmation with no code changes; duplicate-name creation rejected; after archiving, write instructions get follow-ups; AI output is confined to definitions (undefined fields / out-of-enum values 422 into follow-ups).
- v4→v5 upgrade: an old database (built-in four categories + historical data) upgrades to three cleared tables, `trackers` without the builtin column, idempotent re-open; a pre-upgrade downtime backup is the deployer's job (WAL notes in operations doc local-and-private-access.md 6.1); an empty database passing `pnpm run validate` is a legal state.
- Real AI calls depend on local keys, are not ordinary automated tests, and are covered by `pnpm run verify:ai` and user testing; verification records live in Git history.

## Open questions

- None (de-builtin-ing is finalized and implemented — see Decision Records; field editing, frequency/duration engines, and cross-tracker statistics are the long-term items recorded there).

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-08-31 · Adopt SQLite as the local schedule data source

**Background**: the JSON scheme had field validation and readable files, but multi-category commits needed hand-rolled transaction logs, temp files, and crash recovery; local and the future server also demanded separate databases.
**Trade-off**: SQLite's native transactions directly guarantee "all succeed or all roll back"; single-file consistent backups beat multi-file atomic replacement; the driver is `better-sqlite3` (synchronous API, consistent with existing transaction semantics) over Node's experimental `node:sqlite`. Rejected: staying on JSON (long-term maintenance of atomic replacement and crash recovery), SQLite holding one big JSON blob (limited field queries and constraints), local-server auto-sync (needs device identity and conflict resolution; the user chose two fully independent environments). Public HTTP contracts unchanged; clients never noticed the storage change.
**Prior evolution**: 2026-08-09 YAML as the only source (readability first) → 2026-08-15 JSON + JSON Schema (machine validation), both superseded by this decision.

### 2026-09-18 · Tracker-first schedule domain (trackers become first-class)

**Background**: what could be recorded was hard-coded across the whole chain (four category tables + hardcoded fields, AI schema and prompts); adding a temporary tracking dimension (e.g. carpal tunnel) meant code changes everywhere, and the built-in four were just "four instances that happened not to be switched off yet".
**Trade-off**: one unified model `trackers`/`tracker_fields`/`tracker_entries` (definitions as data, one JSON row per day) — isomorphic to the existing "date → field map" domain shape, making migration and read/write mapping direct; the built-in four's cross-field rules and web-specific rendering stayed as code keyed by slug (a safe subset; forcing generalization would widen the regression surface); field types converged to five (boolean / number / single-select enum / text / time), no multi-select, counters, or ratings; proposal actions gained `create_tracker`/`archive_tracker`/`amend_tracker` — amend allows only adding and disabling fields (tightened the same day after a real blind test exposed the "narrowing fields" need), forbidding renames, type changes, and data deletion; months derive from entries, empty months do not exist, the first write creates the month.
**Follow-up**: the built-in special-case layer was removed entirely by the 2026-10-09 decision.

### 2026-09-27 · Extraction-rule copy belongs to the schedule domain

**Background**: the AI adapter files mixed two responsibilities — schedule extraction-rule copy (derived from in-domain data structures and validation rules, i.e. schedule domain knowledge) and request-message assembly (AI transport detail); adding a record type meant editing infrastructure files.
**Trade-off**: domain knowledge to the domain, transport to infrastructure — same shape as the notes domain's `operations.ts`, a forward application of vertical-domain dependency direction with zero new cross-domain edges; migration verified by "byte-identical assembled output", promising unchanged behavior with only ownership moved. The criterion was written down: knowledge belonging to a domain sinks into that domain (ownership of cross-domain shared business assets was later re-ruled by the "AI business parts into domains" ADR as the main consuming domain, injected at assembly).

### 2026-10-04 · Migration baseline consolidation (v0→v4 direct)

**Background**: in the four-step migration chain, the v1→v2 move would never run for existing data (local and production were both v4), yet the whole chain was live code for fresh-database creation and seeding the built-in four — undeletable.
**Trade-off**: executed after the user confirmed all backups were upgraded or explicitly abandoned v1–v3 — the migration table became a single v0→v4 direct step (create three tracker tables and seed the built-in four in one transaction); v1–v3 databases went from "upgradable" to "explicitly refused to open" with refusal leaving files untouched; `MigrationStep` became explicit `from`/`to`; from then on schema upgrades still only append new steps, never touching the baseline.
**Follow-up**: the 2026-10-09 decision rewrote the baseline per user instruction (no seeding, builtin column removed, baseline goes straight to v5) — the "never change the baseline" convention was thereby explicitly superseded by user decision.

### 2026-10-09 · De-builtin-ing and data reset (trackers fully user-defined)

**Background**: the special-case layer for the built-in four (static allowlists, schema, prompts, proposal-card copy, hand-written views on both apps) prevented the user from reorganizing categories around their own life; the user was explicit during design alignment: no pre-installed categories, the existing four and historical data cleared together (backups in hand).
**Trade-off**: delete the `builtin` concept and all four special cases; validation/schema/prompts/copy/pages generated single-track from definitions; new databases go v0→v5 directly with no seeding, empty-system start (`tracker_actions.create` is the only entry); v4→v5 clears the three tables in one transaction and rebuilds `trackers` without the builtin column; v1–v3 refusal unchanged; the exercise/habit cross-field special-case validation and negation cleanup were deleted with it, leaving generic type validation; the month-view summary switched to generic rules (boolean x/y, times, first enum/number, fallback "recorded"). Rollback condition: while the backup is kept, the whole database can roll back to v4, **together with the code** (new code would clear the old backup again; steps in operations doc local-and-private-access.md 6.2). Full trade-offs in the ADR "schedule trackers fully user-defined".
