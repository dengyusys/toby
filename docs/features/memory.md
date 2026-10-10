# Memory Domain

English | [简体中文](memory.zh.md)

> Target contract (domain not yet implemented): responsibilities, contracts, boundaries, and acceptance. Implementation is defined by code and tests.
> Related decisions: "merging Memory into the single server process"; in-domain decision history (hybrid retrieval and episodic distillation) is in the Decision Records at the end.

## Responsibilities and boundaries

The user says in conversation "remember that I don't eat cilantro" or "drop that memory" and gets a pending memory proposal card (a list of save/delete actions); after review and confirmation (or the 30-second timer), it writes into `data/memory.db`.

- Only **long-term information** that affects how the companion serves enters memory: preferences, constraints, personal facts, important decisions, ongoing-matter status (one-off todos belong to the board, check-ins to the schedule, diaries and essays to notes).
- Memory is consumed in two directions: **hybrid retrieval** injected before each domain's proposal generation (a few entries relevant to the current utterance), and the companion's `list_memories` read-only tool.
- On the day's first interaction, **episodic distillation**: review recent chat history, distill new memory proposals, and merge near-duplicates along the way.

**Owns**: the `/api/memories*` management surface (list / direct write / soft delete / context), memory proposals (generate/confirm/cancel), hybrid retrieval, the embedding write pipeline, episodic distillation.

**Does not own**: diaries, essays, and one-off affairs (each has its home); decay cleanup and batch-delete proposals (next round); the memory page search box.

## Behavior contract

### Data table

`data/memory.db` (overridable via `TOBY_MEMORY_DB`), created automatically on first start; an old database (with the importance column) migrates wholesale to Schema v2 on open, data preserved:

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  memory_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('profile','preference','constraint','decision','project','diary')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,                 -- shelf life: query side filters automatically on expiry
  needs_embedding INTEGER NOT NULL DEFAULT 1,
  last_accessed_at INTEGER,           -- retrieval hit accounting (basis for the forgetting pass)
  access_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, scope, memory_key)
);
```

Companions: `memory_meta` (key-value: embedding model/dimensions, distillation watermark), `memories_fts` (FTS5 trigram full-text index, synced by triggers with the main table, removed on soft delete), `memories_vec` (vec0 vector virtual table, not created when embedding is unconfigured or the extension fails to load). **importance is retired** (decision "memory hybrid retrieval and distillation", below).

### Retrieval (how memory is consumed)

For a query text, three recall paths each take 20 — vector (semantic similarity), literal (FTS5, degrading to LIKE below 3 characters), recency (recently updated + access count) — fused by RRF ranking into the top 12, with active constraint-class memories guaranteed a seat (cap 5); hits update access accounting. Degradation chain: embedding failure/unconfigured → literal + recency; extension missing → same; everything failing → pure recency (whose cap equals the old full-sort behavior). Context format `- [category] key: content`, 3000-character budget unchanged.

### Episodic distillation

When more than 24h have passed since the last run and new messages exist past the watermark, it runs synchronously before the day's first user message is answered: review the last 200 messages / 7 days past the watermark → AI distillation (cap 8, upsert only) → vector near-duplicate merging (≥0.90 reuse the old key + remove the duplicate; ≥0.98 count as already covered and skip) → a leading memory proposal card. The watermark advances at proposal generation — **cancelled entries are never re-proposed**; distillation failures skip silently.

### API

All JSON (`GET /api/memories/context` is text/plain); error envelope `{ error: { code, message } }`:

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /api/memories` | `userId?`, `projectId?` | `200 { memories: [{ memory_key, category, content, updated_at }] }` (descending by update time, active and unexpired only, cap 50) |
| `GET /api/memories/context` | `userId?`, `projectId?`, `query?` (optional: with a query term, hybrid retrieval; without, the full list) | `200 text/plain` context text |
| `POST /api/memories` | `{ userId?, action, memoryKey, category?, content?, expiresAt? }` | `200 { status, action, memoryKey }` (direct write; the management surface bypasses proposals) |
| `DELETE /api/memories` | `userId?`, `memoryKey`, `projectId?` | `200 { status: "removed", memoryKey }` (soft delete) |
| `POST /api/memories/proposals` | `{ message, userId?, projectId?, messageId? }` (message ≤2000 characters) | `200 { proposal_id, expires_at, reply, actions }`; with no actionable operation (nothing worth saving distilled, or the delete target not in this round's list) `200 { proposal_id: null, reply }` — no proposal card; the reply is rendered as the conversation body by the chat domain (revision, 2026-10-06) |
| `POST /api/memories/proposals/:id/commit` `/cancel` | id from the URL only | `200 { status, actions }` / `{ status: "canceled" }` |

Proposal actions (`actions[]` elements, ≤5 per turn, ≤8 for distillation):

```jsonc
{ "action": "upsert", "memoryKey": "lowercase alphanumeric dot underscore hyphen",
  "category": "profile|preference|constraint|decision|project",
  "content": "1-300 characters", "expiresAt": 1759276800000 }  // expiresAt optional, temporal facts only
{ "action": "remove", "memoryKey": "…" }               // the target must appear in this round's context
                                                       // list (hallucination guard). Deletion intent is
                                                       // judged by the AI, no phrasing gate (user decision
                                                       // 2026-10-06, same discipline as the board's
                                                       // "tear off" — the deterministic defense line is
                                                       // the target allowlist and the proposal card)
```

Error codes carry over: `PROPOSAL_NOT_FOUND`(404), `PROPOSAL_EXPIRED`(410), `PROPOSAL_CANCELED`(409), `PROPOSAL_ALREADY_COMMITTED`(409), `PROPOSAL_COMMIT_FAILED`(422), `INVALID_REQUEST`(400), `INVALID_MEMORY_KEY`(400), `INVALID_INTEGER`(400), `PAYLOAD_TOO_LARGE`(413); method mismatch 405, unknown path 404 (server semantics).

### Embedding configuration

| Environment variable | Default | Notes |
| --- | --- | --- |
| `TOBY_EMBEDDING_API_KEY` | — (unconfigured disables embedding, retrieval degrades, the process starts normally) | Zhipu API key |
| `TOBY_EMBEDDING_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI-compatible endpoint |
| `TOBY_EMBEDDING_MODEL` | `embedding-3` | Model name |
| `TOBY_EMBEDDING_DIMENSIONS` | `1024` | Dimensions (a change triggers full re-embedding) |

Real-service regression: `pnpm run verify:embedding` (run manually by the administrator).

## Boundaries and security

- Write discipline unchanged: the AI produces proposal content only; database writes execute after server confirmation; distillation output likewise passes proposal review.
- Sensitive content (regex hits for keys / ID numbers etc.) is never sent to the external embedding service — literal retrieval only.
- Memory content is sent to Zhipu for vectorization, the same class of exposure as conversation text sent to the AI provider; deletion is soft and recoverable.
- Open: the implicit memory write on schedule-commit `onCommitted` bypasses review (existing behavior; whether to tighten it is an open point in the Decision Records).

## Acceptance

- Proposal flow: generation writes nothing, confirmation is idempotent, cancellation refuses commit, expiry 410 (anchored by contract tests).
- Deletion path: deletion intent judged by the AI with no phrasing gate (the incident sentence "把刚记的那条记忆删了吧" is a regression case); the deterministic defense is the target allowlist dropping unknown keys; empty actions produce no proposal card, the reply becomes conversation body (2026-10-06).
- Retrieval: three-way fusion with the constraint guarantee seat, degradation chain (embedding failure / no vector table), access accounting, TTL filtering, FTS Chinese two-character degradation to LIKE (anchored by unit tests with deterministic fake embeddings).
- Distillation: the 24h trigger window, watermark advance (cancelled items not re-proposed), near-duplicate merging, AI removes dropped, silent failure (anchored by unit tests).
- Migration: a v1 database (importance column) migrates to v2 on open, data preserved, FTS backfilled, idempotent.
- Automation never calls real AI; real embedding goes through the manual `verify:embedding` regression.

## Decision records

Background and trade-offs of this domain's historical decisions. Append-only, never rewritten; implementation detail is defined by code and tests; full originals live in Git history.

### 2026-10-01 · Hybrid retrieval, episodic distillation, and retiring importance

**Background**: the memory domain used to "copy everything" — all active memories injected into every prompt, top 50 by importance + recency, capped at 3000 characters; against long-term volume expectations (hundreds to 2000 entries) this was bound to fail — most memories would never get a turn while irrelevant ones kept diluting the prompt. Three gaps at once: retrieval didn't understand paraphrase; chat history (episodic memory) and the memory store (semantic memory) never talked; AI-invented memoryKeys drifted into near-duplicates.
**Trade-off**: decouple "what gets stored" from "how it's fetched" — the admission bar loosens, on-demand retrieval keeps the context clean; three-way recall (vector sqlite-vec KNN + FTS5 trigram literal + recency floor) fused by RRF ranking into the top 12, with a permanent constraint-class guarantee seat (constraints don't pick topics), and retrieval never throws or blocks proposals; the embedding service is independently configured (Zhipu API; unconfigured disables it wholesale with degraded retrieval) rather than a separate vector database — a new service process at thousand-entry scale violates "single process + SQLite-only"; episodic distillation runs synchronously on the day's first interaction rather than on a background timer — the proposal TTL is only 10 minutes, an idle midnight run would always expire, and synchronous execution guarantees "no idle expiry, no unattended writes" at minimal complexity; near-duplicates merge via cosine probes (≥0.90 same matter, ≥0.98 already covered) reusing the old key; importance retired wholesale (user decision) — AI-assigned 1–5 scores drift across turns, and once retrieval exists the ranking role disappears, with the always-present background carried by the constraint class (category judgment is stabler than absolute scoring).

### 2026-10-06 · Wide matching for deletion intent, and no card for empty actions

**Background**: the user said "把刚记的那条记忆删了吧" (delete the memory just recorded); the AI correctly proposed remove, but the deletion-intent gate was a verbatim keyword list (forget / delete memory / delete this memory…) — the word order in "记忆删了" matched nothing, and the action was **silently dropped** by the policy layer; the proposal service then built a card as usual, showing the user an empty card saying "nothing worth saving was distilled" — which the 30-second timer even "confirmed and wrote" once (live conversation test).
**Trade-off**: a two-layer fix — ① the gate became a wide-matching regex: "delete/erase/clear" and "memory/just recorded" in either word order, with the verb–noun gap capped at 6 characters of punctuation ("把刚记的那条记忆删了吧", "把刚记的删了", "忘掉刚才记的" all pass; "把这个待办删掉" and "记忆里都有什么" are unharmed); remove targets still had to be keys seen in this round's list (hallucination guard untouched). ② Empty actions no longer build a proposal card: return `proposal_id: null` + reply, and the conversation envelope renders the reply as the body (a statement, not a follow-up — no follow-up prefix), the same discipline as the todo domain's "no target, no card"; the no-op success branch for empty-action payloads on commit is kept as defense. The prompt gained the rule "when the user explicitly asks to delete, propose remove for the matching memoryKey; if not found, say so honestly". Rejected: deleting this intent-gate layer and trusting the AI alone — the gate is a second deterministic defense against "AI hallucinating remove"; wide matching preserved it rather than tearing it down.

### 2026-10-06 · Withdrawing the phrasing gate for deletion intent (option 1)

**Background**: the previous revision (wide matching) was questioned by the user the same day: should a verbatim keyword gate on a destructive action exist at all, for software with a universal, open-source positioning? Comparing open-source practice — mem0's memory pipeline lets the LLM emit ADD/UPDATE/DELETE events; Letta/MemGPT agents manage memory blocks autonomously with tools; LangGraph guards destructive operations with a pre-execution interrupt rather than phrasing analysis — the consensus: "does the user want to delete" is a semantic judgment for the model; "may this entry be deleted, and should it be confirmed first" is the job of deterministic code; nobody gates user phrasing with regexes. And in this repository, the board's "tear off" (physical deletion) and notes deletion had long been AI-judged + target allowlist + proposal card with no phrasing gate — memory was the only exception among the five domains (a legacy of the merged standalone memory service). Wide matching only lowered the miss rate; phrasing is inherently unenumerable ("那条不要了", "刚才说的不算" would stay outside forever).
**Trade-off**: the user settled on option 1 — withdraw the phrasing gate; deletion intent is judged by the memory AI (prompt rules carry it), fully the same discipline as the board's "tear off"; the deterministic defense stays on the execution side: the target allowlist (a remove's key must have been seen in this round's list, session layer) and proposal-card confirmation (including the 30-second auto-write). Anti-drift protection for "AI proposing remove" drops from four layers to three (prompt, target allowlist, proposal card) — the risk is accepted, since todo tear-off (a harder-to-reverse physical delete) had long run the same risk profile, and memory deletion is soft (recycle-bin mitigation). The sensitive-content and transient-message filters on the upsert side are untouched (they intercept content and context, not deletion intent). Rejected: option 2 (proposals containing remove skip the 30-second auto-write and require explicit confirmation) — closer to LangGraph-style human-in-the-loop, but it forks the unified "silence means consent" write semantics and touches the proposal lifecycle kernel; keeping the phrasing gate as a fallback — contrary to open-source practice, and the "some phrasings can never delete" defect is unfixable.
