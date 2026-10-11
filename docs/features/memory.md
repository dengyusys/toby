# Memory Domain

English | [简体中文](memory.zh.md)

> Target contract (domain not yet implemented): responsibilities, interface, and key rules; implementation details live in code and tests.

## Responsibilities and boundaries

Say "remember I don't eat cilantro" in the chat, get a memory proposal card (save/remove actions), confirm, and it writes into `data/memory.db`.

- Stores only **long-term information** that shapes the companion's service: preferences, constraints, personal facts, important decisions, ongoing matters. One-shot items belong to the todo board, daily check-ins to schedule, diary musings to notes.
- Consumed in two directions: **hybrid retrieval** injected before each domain's proposal generation, and the companion's read-only memory tool.
- **Episodic distillation** on the day's first interaction: distills recent chat into memory proposals and merges near-duplicates.
- **Does not own**: decay cleanup, batch-delete proposals, the memory-page search box.

## Core concepts

- A memory = key + category (profile/preference/constraint/decision/project) + content + optional expiry + status (soft-deleted, recoverable).
- The importance score is retired: ranking belongs to retrieval; constraint-class memories always ride along.
- The embedding service is optional: unconfigured degrades retrieval; the process still starts.

## Interface

All JSON (the context endpoint returns text/plain); errors follow the server's standard envelope.

| Method and path                                      | Purpose                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/memories`                                  | Management list (active, unexpired, newest first)                                          |
| `GET /api/memories/context`                          | Context text; with a query goes hybrid retrieval, without one a full list                  |
| `POST /api/memories`                                 | Management direct write (no proposal)                                                      |
| `DELETE /api/memories`                               | Soft delete                                                                                |
| `POST /api/memories/proposals`                       | One sentence → memory proposal; no actionable action returns a follow-up instead of a card |
| `POST /api/memories/proposals/:id/commit` · `cancel` | Confirm / cancel                                                                           |

## Key rules

- Proposal actions are upsert / remove only; a remove target must be in the list injected this round (hallucination guard); deletion intent is judged by the AI — no phrasing gate.
- Retrieval recalls three ways (vector/literal/recency), fuses by rank, and keeps a constraint-class guarantee seat; embedding failures degrade step by step — retrieval never blocks proposals.
- Distillation runs synchronously before the first user message after a 24-hour gap; the watermark advances at proposal generation, cancelled items are never re-proposed; failures pass silently.
- Sensitive content (regex hits for keys, ID numbers) is never sent to the external embedding service — literal retrieval only.
- Memory content goes to an external service for vectorization, the same exposure class as chat text sent to the AI.
- Distillation output goes through the same proposal review; automated tests never call real embeddings — those get a manual regression.

## Acceptance highlights

- Proposal flow's four states: generation writes nothing, confirmation is idempotent, cancellation refuses commit, expiry returns 410.
- Retrieval: three-way fusion and the constraint seat, degradation chain, access accounting, expiry filtering (deterministic unit tests with fake embeddings).
- Distillation: trigger window, watermark advance (cancelled items not re-proposed), near-duplicate merging, silent failure.
- Empty actions produce no card — the reply becomes conversation body; remove targets outside the list are rejected.
