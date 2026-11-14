# Memory Domain

English | [简体中文](memory.zh.md)

> Live contract: what a memory entry is, how memory reaches prompts, how every
> change lands, and the page. Implementation details live in code and tests; the
> full rationale is [personal-agent-memory](../decisions/personal-agent-memory.md).

## What this is

The butler's living memory: it learns without being asked (silent learning),
forgets what stops being true, and reports every change. One principle governs
the domain — the AI may remember and may forget, but every change leaves a
receipt, and the user can veto any entry with one sentence. Storage is one
strictly parsed Markdown file behind a repository port.

## Responsibilities and boundaries

- Owns `data/memory/MEMORY.md` — the repository's one non-database storage (the
  recorded exception to one database per domain), behind the memory repository
  port; the Markdown file is its only implementation today, swappable in the
  composition root without touching domain code.
- Owns the memory tools (`recall` / `remember` / `forget` / `off_record`), the
  `<memory>` prompt-section builder, the off-record conversation flag, and the
  page APIs.
- **Does not own**: events (notes and chat history own events; memory holds only
  the stable background no domain claims), retrieval infrastructure (no vectors —
  the model is the retriever, the tool turns the pages), or any write outside the
  memory file.

## Core concepts

- The entry: three types, one line each — no id, no source, no timestamps,
  deliberately.

```markdown
## 约定

- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 2026-11-30)

## 关于我

- 不吃香菜

## 人物

- 小王:房东
```

- One entry = type + text (+ `name` for 人物) + optional `(至 YYYY-MM-DD)` expiry
  — a real calendar date. `until < today` (UTC) means expired.
- Who sees what: 约定 goes to every database-writing agent and the intent
  classifier (a missed convention is a silent wrong write); 关于我 informs chat
  answers only; 人物 informs chat and ledger interpretation (name hits — never
  amounts or dates on their own).
- The parser is deterministic and part of validation: a line that does not parse
  rejects the write; a corrupt file is refused everywhere
  (`500 MEMORY_FILE_INVALID`, fix by hand) — never silently repaired. Hand edits
  of the file are welcome.
- The receipt of one landed change: `{action, type, before?, after?, created_at}`
  — before/after quote the rendered file lines. Cards reuse the chat proposal
  card; the webs render them by domain id `memory`.

## How it is read

Layered by the cost of forgetting:

| Layer                  | Mechanism                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| 约定                   | written in full into the `<memory>` section of every db-writing agent and the intent classifier |
| 人物, on a write path  | remembered names are looked up literally in the sentence; hitting entries ride the section      |
| 人物 + 关于我, in chat | an index (names; 关于我 texts) stays in the prompt; bodies fetched with `recall`                |

- The `<memory>` section is resolved fresh on every run, rendered after
  `<rules>` and before `<context>`; it is the one section allowed to name a tool
  (the index heading names `recall` by design).
- `recall` is deliberately dumb: case-insensitive substring over names and
  texts, all types, non-expired entries only; no keyword flips through the whole
  book — that is how 你记得我什么 is answered, verbatim. Paraphrase is the
  model's job.
- A corrupt file degrades the section to a visible placeholder
  （记忆文件当前无法读取） — chat keeps working, memory stays visibly broken.

## How it is written

- Three conversational tools: `recall` (read-only) plus `remember` / `forget`
  (write-intent). Every conversational agent (chat's none agent, ledger's
  extractor) carries all three — silent learning rides whichever agent is
  already running. `off_record` (write-intent) exists for the explicit
  这通别记 / 可以记了 sentences and stays on the memory domain's own agent.
- Explicit memory sentences (记住X / 忘掉X / 你记得我什么 / 这通别记) route to
  the memory capability like any registered domain; the memory agent resolves
  them with the same tools.
- Locating an old line: updates and deletes carry one keyword, matched with
  exactly recall's substring rule over names and texts, non-expired entries
  only. Exactly one hit → replace or delete; several → refuse and list the
  candidates (ask, never guess); zero → forget answers 没有相关记忆 and a
  remember-with-replace appends as new. A plain append checks duplicates first
  (identical line → 已记得).
- Every write: deterministic validation (format, real calendar dates,
  replace-vs-duplicate, cap) → one atomic full-file replace (temp file + rename)
  → receipt. The page's edit/delete uses the same discipline with an exact-line
  locator.
- The cap is 500 entries: full means refusal plus 该忘点什么 — never silent
  truncation, never summarization.
- Off the record: one sentence or the page toggle flags the conversation; while
  it is on, every `remember` / `forget` call is refused at the tool (the refusal
  is visible to the model and in traces), and a new conversation resets the
  flag. Deletion is not a ban — a re-learned entry leaves a new receipt.
- In chat, a remember/forget that lands mid-run becomes its own proposal card
  after the transcript (silent learning stays visible); a ledger write response
  may carry an optional `memory_receipts` sidecar for the same reason — absent
  when nothing was learned.

## The page

The butler's memo, not a database table — both webs render the entries grouped
约定 → 关于我 → 人物; expired entries last, awaiting renewal or deletion; each
entry editable and deletable inline; the top bar exports an on-demand `.md`
snapshot (never stored server-side); the off-record toggle lives here too.

## Interface

All JSON except the export (`text/markdown`); every route follows the session
guard; errors use the server's standard body.

| Method and path                  | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `GET /api/memory`                | Every entry, 约定 → 关于我 → 人物, expiry resolved       |
| `POST /api/memory/entries`       | Append (or replace-keyword update) one entry → receipt   |
| `POST /api/memory/entry/replace` | Exact-line replace or delete (`current`, `next \| null`) |
| `POST /api/memory/entry/forget`  | Delete the one keyword hit → receipt                     |
| `GET /api/memory/export`         | The `.md` snapshot, on demand only                       |
| `GET /api/memory/off-record`     | The off-record flag                                      |
| `POST /api/memory/off-record`    | Set the flag                                             |

| Failure                        | Answer                                        |
| ------------------------------ | --------------------------------------------- |
| shape or value violates format | `400 INVALID_ENTRY`                           |
| no matching entry              | `404 ENTRY_NOT_FOUND`                         |
| several hits / duplicate lines | `409 AMBIGUOUS_ENTRY` (candidates in message) |
| identical line already stored  | `409 DUPLICATE_ENTRY`                         |
| cap reached                    | `409 LIMIT_REACHED` (该忘点什么？)            |
| MEMORY.md unparseable          | `500 MEMORY_FILE_INVALID` (fix by hand)       |

## Invariants

1. One write = one validated, atomic full-file replace; there is no partial
   write and no second storage (no always-synced export file).
2. The parser is part of validation; anything that does not parse is refused,
   never repaired.
3. Every landed change leaves a receipt quoting the file's own lines;
   replacement never coexists with the old line.
4. Expired entries appear nowhere but the page's last group — not in prompts,
   not in recall, not in lookups.
5. `remember` / `forget` and the page's exact-line endpoints are the only write
   paths, and the tools refuse while the conversation is off the record.
6. The AI never sees a file path; the tool boundary is the whole surface.

## Out of scope (for now)

- Vectors, embeddings, or any retrieval infrastructure — the model is the
  retriever.
- A veto ledger or per-topic bans: deletion deletes; re-learning is answered by
  visibility (receipts) and the one-sentence delete, not prevention.
- Per-entry scopes or sources; a database adapter (the port leaves the door
  open).
