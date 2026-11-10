# Ledger Domain

English | [简体中文](ledger.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

- Recording: one sentence in the chat (multiple entries allowed) becomes a direct write — the batch lands in the ledger database at once as one transaction and the card is a receipt (`data/ledger.db` on SQLite; MySQL schema `toby_ledger`).
- Viewing: per-day subtotals and monthly summaries, category totals, by month.
- Deletion: a user-initiated delete of one stored transaction — the domain's only write outside the AI card path.
- Amounts are stored as **integer cents** end to end — no floating-point drift.
- **Does not own**: editing records, budgets and report charts, multi-account systems, multi-currency.

## Core concepts

- A transaction = date + type (expense/income) + category + account + amount (cents) + note; the account is optional and defaults to “未关联”.
- Every entry in a sentence is extracted: one command carries 1–10 transactions, written atomically as one batch — one receipt card.

## Interface

All JSON; errors follow the server's standard error body. A body that violates the
request _shape_ (a missing intake path, a non-string `text`, an unknown entry type)
is answered by the route schema as `BAD_REQUEST`; a well-formed body whose values are
nonsense (bad amount, impossible date, blank category) is answered by the domain as
`INVALID_ENTRY`.

| Method and path                              | Purpose                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/ledger/months`                     | Months with records (newest first)                                                                                |
| `GET /api/ledger/transactions?month=YYYY-MM` | Monthly transactions + summary (income/expense totals, by category)                                               |
| `POST /api/ledger/entries`                   | One sentence (AI, multi-entry) or a structured single entry (deterministic path); uncertainty returns a follow-up |
| `DELETE /api/ledger/transactions/:id`        | Delete one stored transaction (user-initiated; unknown ids answer 404 `TRANSACTION_NOT_FOUND`)                    |

## Key rules

- AI extraction is untrusted input: it must pass the domain's deterministic validation and normalization before anything is written.
- Amounts: non-negative numbers with at most two decimal places, parsed digit-wise into cents. Dates: local format plus calendar validation; any past or future date is legal (backfill); a sentence with no date defaults to today.
- Uncertain fields return a follow-up question, never a guess; the user retries with more detail.
- Write path: direct — the batch executes transactionally at once; the card is a receipt. No revert endpoint, no confirmation gate; recovery is writing again or backup.
- One failed entry rolls back the batch.
- Deletion removes one row by id in a single transaction; ids must be positive integers (else `INVALID_ENTRY`), unknown ids answer 404 `TRANSACTION_NOT_FOUND` (a repeated delete takes this path).
