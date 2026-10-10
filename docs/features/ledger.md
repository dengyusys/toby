# Ledger Domain

English | [简体中文](ledger.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: in-domain decision history (domain creation and storage choice) is in the Decision Records at the end.

## Responsibilities and boundaries

- View the books: the web (sidebar ledger panel and fullscreen viewer) shows daily income/expense subtotals and monthly summaries for any month in a calendar.
- Record: one sentence in the chat page (multiple entries allowed) generates a proposal; after review, confirm to write into `data/ledger.db`.
- Coexistence and precision: imported history and new records coexist in one ledger; amounts are stored as **integer cents** throughout — no floating-point drift.

**Owns**: `/api/ledger/*` month, monthly-transaction, and category-summary queries; one-sentence AI proposals and structured proposals; confirm/cancel and whole-batch atomic writes.

**Does not own**: editing or deleting records; budgets, report charts, multi-account systems, multi-currency; historical import migration (already done — the domain only inherits the existing database).

## Behavior contract

### Data table

`data/ledger.db` (overridable via `TOBY_LEDGER_DB`); the fresh-database DDL is verbatim identical to the imported one:

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY,
  date         TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  account      TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  source_line  INTEGER NOT NULL
);
```

### API

All JSON; session cookie required when auth is enabled; error envelope follows the server convention `{ error: { code, message } }`:

| Method and path | Request | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/ledger/months` | — | `200 { "months": ["2026-09", …] }` descending | — |
| `GET /api/ledger/transactions?month=YYYY-MM` | month query parameter | `200 { month, transactions: LedgerTransaction[], summary: { expense_cents, income_cents, by_category: [{ category, type, total_cents, count }] } }` | `400` invalid month |
| `POST /api/ledger/proposals` | `{ message }` (one sentence, AI-parsed, multiple entries allowed; preferred) or `{ transaction: { date, type, category, account?, amount, note? } }` (deterministic single entry) | `200 { proposal_id, expires_at, transactions: normalized field array (1–10 entries) }`; when the AI is unsure, `200 { proposal_id: null, question }` | `400` field validation; `422 LEDGER_TOO_MANY` over 10 entries; AI failures `503 AI_UNAVAILABLE`/`504 AI_TIMEOUT`/`502 AI_BAD_OUTPUT` |
| `POST /api/ledger/proposals/:id/commit` | — | `200 { status: "committed", transactions }` (whole batch lands atomically, same length as the proposal) | `404` not found / `410` expired / `409` cancelled / committed returns idempotently |
| `POST /api/ledger/proposals/:id/cancel` | — | `200 { status: "canceled" }` | `404` / `410` / `409` already committed |

### Key rules

- A sentence containing multiple entries extracts all of them: one proposal carries all transactions (1–10), one confirmation, one atomic batch write; any single failure rolls back the whole batch.
- Proposal TTL is 10 minutes, matching schedule/memory; commit is idempotent (an already-committed proposal returns the first result, no duplicate rows). A proposal shown 30 seconds without cancellation is auto-committed by the server (user decision, 2026-10-05), via the same commit path as manual confirmation.
- **User path**: type a sentence in the chat page → intent routing enters the ledger path → if the AI can produce complete fields, a pending proposal returns (nothing written); if unsure, a follow-up question (`{proposal_id: null, question}`); the user adds details and retries → review field rows per entry on the message card → confirm or cancel.
- The structured form (`{transaction}`) is the deterministic path of the same proposal endpoint, for tests and programmatic calls.
- After a successful confirmation the sidebar ledger panel refetches — same rhythm as the month view refreshing after a schedule confirmation.

### Exceptions and edges

- **Amount precision**: `"19.99"` is parsed digit-wise as a string into `1999` cents; `19.9`, `5`, `0` are legal (normalized to `"19.90"`, `"5.00"`, `0` cents); `19.999`, `-3`, `1e3`, `０.５` (full-width) are rejected with "amount must be a non-negative number with at most two decimal places".
- **Dates**: `2026-02-30`, `2026-13-01`, `2026-2-3` (not zero-padded) rejected; `2024-02-29` (leap year) legal; any past or future date may be recorded (catch-up bookkeeping).
- **Proposal expiry**: after the TTL, commit/cancel returns `410 PROPOSAL_EXPIRED`; when the remaining-seconds display hits zero, the web disables the confirm button.
- **Concurrency**: writes serialize through synchronous SQLite transactions; the same proposal cannot be concurrently committed twice (in-memory store, single-process semantics — the server is the only writing process).
- **Permissions**: all `/api/ledger*` sit inside the auth scope; unauthenticated access gets 401 from the global auth guard.
- **Data anomalies**: missing or empty database → `months` returns an empty array and lists are empty, with the web showing the empty state; a schema mismatch bubbles the SQLite error as 500, never swallowed silently.
- **Request body**: non-object/string bodies return `400 INVALID_REQUEST`; unknown fields ignored.

## Security boundaries

- Required: every new write goes "generate proposal → user review → confirm with the `proposal_id` in the URL".
- Forbidden: AI output landing in the database directly — AI extraction is untrusted input that must pass in-domain deterministic validation and normalization before a proposal exists.
- Forbidden: ledger tests touching the production `data/ledger.db` — all tests build databases in temporary directories.

## Acceptance

- Automated (passing; see the ledger integration tests in `apps/server/test/` and the root HTTP integration tests): validation and normalization (amount/date/type/overlong-category rejections with no proposal and no rows), proposal lifecycle (commit lands, idempotent, cancel 409, expiry 410), AI path (a stub returning a bad amount still yields `400` — AI output is never exempt from deterministic validation), full-endpoint HTTP contract.
- Manual browser acceptance (record one entry, monthly summary correct) awaits user review.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-09-13 · Ledger as the server's fourth business domain

**Background**: the user's export from a personal-finance app had been normalized into a local SQLite database, but the data was an island — the server didn't know it and the web had no entrance; it needed read/write entrances isomorphic to schedule and memory.
**Trade-off**: an independent business domain rather than folding into schedule/memory — income/expense types, amounts in cents, categories, and accounts have a domain model completely different from both, and forcing reuse would pollute both sides' field allowlists and validation rules; an independent `ledger.db` rather than merging into schedule.db — the schedule database lives under the strictest data-protection constraints (validation, backup, SHA-256 procedures), the ledger writes frequently with a different lifecycle, and file-level isolation keeps them from dragging each other; proposal confirmation rather than direct CRUD — otherwise bookkeeping would become the app's only "write without confirmation" surface, breaking the "confirm first, then record" mental model, and the proposal layer doubles as the natural slot for AI parsing; amounts as integer cents throughout, carried as decimal strings — eliminating floating-point summation drift at the root. Rejected: one-shot AI natural-language parsing to final records (couldn't close the loop with local automation in v1; interface reserved), reusing the schedule proposal pipeline (deeply coupled to schedule operation contracts; retrofitting cost more than a new lightweight domain).
