# Ledger Domain

English | [简体中文](ledger.zh.md)

> Responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

- Recording: one sentence in the chat (multiple entries allowed) becomes a proposal; confirmation writes into the ledger database (`data/ledger.db` on SQLite; MySQL schema `toby_ledger`).
- Viewing: per-day subtotals and monthly summaries, category totals, by month.
- Amounts are stored as **integer cents** end to end — no floating-point drift.
- **Does not own**: editing or deleting records, budgets and report charts, multi-account systems, multi-currency.

## Core concepts

- A transaction = date + type (expense/income) + category + account + amount (cents) + note; the account is optional and defaults to “未关联”.
- Every entry in a sentence is extracted: one proposal carries 1–10 transactions, confirmed once, written atomically as a batch.

## Interface

All JSON; errors follow the server's standard envelope.

| Method and path                              | Purpose                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/ledger/months`                     | Months with records (newest first)                                                                                |
| `GET /api/ledger/transactions?month=YYYY-MM` | Monthly transactions + summary (income/expense totals, by category)                                               |
| `POST /api/ledger/proposals`                 | One sentence (AI, multi-entry) or a structured single entry (deterministic path); uncertainty returns a follow-up |
| `POST /api/ledger/proposals/:id/commit`      | Confirm: atomic batch write (idempotent)                                                                          |
| `POST /api/ledger/proposals/:id/cancel`      | Cancel the proposal                                                                                               |

## Key rules

- AI extraction is untrusted input: it must pass the domain's deterministic validation and normalization before a proposal exists.
- Amounts: non-negative numbers with at most two decimal places, parsed digit-wise into cents. Dates: local format plus calendar validation; any past or future date is legal (backfill).
- Uncertain fields return a follow-up question, never a guess; the user retries with more detail.
- Proposal TTL 10 minutes; uncancelled after 30 seconds the server auto-writes; commit is idempotent — no duplicate rows; cancelled proposals refuse commit, expired ones answer 410; records pruned one hour past expiry answer 404.
- One failed entry rolls back the batch.
