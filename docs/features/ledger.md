# Ledger Domain

English | [简体中文](ledger.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

- Recording: one sentence in the chat (multiple entries allowed) becomes a direct write — the batch lands in the ledger database at once as one transaction and the card is a receipt (`data/ledger.db` on SQLite; MySQL schema `toby_ledger`).
- Viewing: per-day subtotals and monthly summaries, category totals, by month.
- Deletion: a user-initiated delete of one stored transaction.
- Editing: a partial, transactional update of one stored transaction — the structured PATCH path, or an AI correction ("把昨天午饭那笔改成 35") resolved deterministically from match criteria.
- Amounts are stored as **integer cents** end to end — no floating-point drift.
- **Does not own**: budgets and report charts, account systems, multi-currency.

## Core concepts

- A transaction = date + type (expense/income) + category + amount (cents) + note.
- Every entry in a sentence is extracted: one command carries 1–10 transactions, written atomically as one batch — one receipt card.
- An edit = match criteria + a partial patch: present fields change, absent fields stay. The AI never supplies a row id — the server resolves the criteria against one day's rows (the named day, else today); exactly one candidate lands, zero or several answer a clarifying question.

## Interface

All JSON; errors follow the server's standard error body. A body that violates the
request _shape_ (a missing intake path, a non-string `text`, an unknown entry type)
is answered by the route schema as `BAD_REQUEST`; a well-formed body whose values are
nonsense (bad amount, impossible date, blank category) is answered by the domain as
`INVALID_ENTRY`.

| Method and path                              | Purpose                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ledger/months`                     | Months with records (newest first)                                                                                                                                                 |
| `GET /api/ledger/transactions?month=YYYY-MM` | Monthly transactions + summary (income/expense totals, by category)                                                                                                                |
| `POST /api/ledger/entries`                   | One sentence (AI, multi-entry) or a structured single entry (deterministic path); uncertainty returns a follow-up                                                                  |
| `PATCH /api/ledger/transactions/:id`         | Partially update one transaction: present fields change, absent fields stay (empty patch answers `INVALID_ENTRY`; unknown ids 404). The AI correction path lands on the same write |
| `DELETE /api/ledger/transactions/:id`        | Delete one stored transaction (user-initiated; unknown ids answer 404 `TRANSACTION_NOT_FOUND`)                                                                                     |

## Key rules

- AI extraction is untrusted input: it must pass the domain's deterministic validation and normalization before anything is written.
- Amounts: non-negative numbers with at most two decimal places, parsed digit-wise into cents. Dates: local format plus calendar validation; any past or future date is legal (backfill); a sentence with no date defaults to today.
- Uncertain fields return a follow-up question, never a guess; the user retries with more detail.
- Write path: direct — the batch executes transactionally at once; the card is a receipt. No revert endpoint, no confirmation gate; recovery is writing again or backup.
- One failed entry rolls back the batch.
- Editing is the same one-transactional-write discipline: the patch is field-validated like a fresh entry (an empty note clears the note), the row is read and updated in one transaction, and the result carries the before/after pair from that transaction.
- AI corrections: the model submits match criteria plus patch — never a row id. The server resolves the candidates deterministically; exactly one lands, zero or several become one clarifying question (naming the day, listing up to five candidates). A correction never records a duplicate entry.
- Deletion removes one row by id in a single transaction; ids must be positive integers (else `INVALID_ENTRY`), unknown ids answer 404 `TRANSACTION_NOT_FOUND` (a repeated delete takes this path).
