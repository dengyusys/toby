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
strictly parsed Markdown file behind a repository port, organized into open
topic sections, all equal; the whole book rides in every agent's prompt.

## Responsibilities and boundaries

- Owns `data/memory/MEMORY.md` — the repository's one non-database storage (the
  recorded exception to one database per domain), behind the memory repository
  port; the Markdown file is its only implementation today, swappable in the
  composition root without touching domain code.
- Owns the memory tools (`remember` / `forget` / `off_record`), the `<memory>`
  prompt-section builder, the off-record conversation flag, and the page APIs.
- **Does not own**: events (notes and chat history own events; memory holds only
  the stable background no domain claims), retrieval infrastructure (none — the
  book is always open, the model reads it in place), or any write outside the
  memory file.

## Core concepts

- The entry: one line under an open topic section — no id, no source, no
  timestamps, deliberately.

```markdown
## 约定

- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 2026-11-30)

## 关于我

- 不吃香菜

## 转账

- 给小王的转账走「人情往来」

## 人物

- 小王:房东
```

- One entry = topic + text + optional `(至 YYYY-MM-DD)` expiry — a real calendar
  date. `until < today` (UTC) means expired. `约定` / `关于我` / `人物` are
  house vocabulary, not special cases; any topic name is legal (non-empty,
  short, unique in the file); people entries keep `名字:描述` as house style.
- The parser is deterministic and part of validation: a line that does not parse
  rejects the write; a corrupt file is refused everywhere
  (`500 MEMORY_FILE_INVALID`, fix by hand) — never silently repaired. Hand edits
  of the file are welcome.
- The receipt of one landed change: `{action, section, before?, after?,
created_at}` — before/after quote the rendered file lines. Cards reuse the chat
  proposal card; the webs render them by domain id `memory`.

## How it is read

One rule, no layers: every non-expired entry of every section is written into
the `<memory>` section of every agent — chat, every database-writing extractor,
the intent classifier, the memory agent — resolved fresh on each run and
rendered after `<rules>` and before `<context>`. The intent classifier and the
write agents therefore see the same book; presence is uniform, relevance is the
model's judgment, and the 500-entry cap is the bound on the book's size.

- A corrupt file degrades the section to a visible placeholder
  （记忆文件当前无法读取） — chat keeps working, memory stays visibly broken.
- Expired entries appear in no prompt; the page shows them as the file's own
  lines.

## How it is written

- Three tools: `remember` / `forget` (write-intent) and `off_record`. Every
  conversational agent (chat's none agent, ledger's extractor) carries remember
  and forget — silent learning rides whichever agent is already running.
  `off_record` stays on the memory domain's own agent for the explicit
  这通别记 / 可以记了 sentences.
- Choosing the section is the model's first judgment: prefer an existing
  section the entry plainly belongs to, open a new one only when nothing fits,
  and the user's explicit instruction (记到「工作」里) always wins.
- Explicit memory sentences (记住X / 忘掉X / 你记得我什么 / 这通别记) route to
  the memory capability like any registered domain; the memory agent resolves
  them with the same tools.
- Locating an old line: updates and deletes carry one keyword, substring-matched
  over all non-expired entry texts. Exactly one hit → replace or delete; several
  → refuse and list the candidates (ask, never guess); zero → forget answers
  没有相关记忆 and a remember-with-replace appends as new. A plain append checks
  duplicates across the whole book (identical text → 已记得).
- Every write: deterministic validation (format, real calendar dates,
  section-name rules, replace-vs-duplicate, cap) → one atomic full-file replace
  (temp file + rename) → receipt.
- The page never writes entries: changes are a chat sentence or a hand edit of
  the file (the diff is the receipt). The page's one write is 重置 (reset) —
  `POST /api/memory/reset`, one atomic empty-file write, a maintenance act: not
  off-record-gated, allowed even when the file is corrupt (explicit discard is
  a recovery path, never silent repair).
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

The butler's memo, not a database table — the page renders `MEMORY.md` itself:
the raw Markdown source in a monospace block, file order, exactly what is on
disk. An empty file reads as the empty state; a corrupt one as the honest
`MEMORY_FILE_INVALID` error. Nothing on the page edits anything — changes are a
chat sentence or a hand edit of the file. The header carries two controls: the
memory toggle (开启记忆 / 关闭记忆) and 重置 — a two-step confirm (entry count,
irreversibility warning) that clears the book to empty in one atomic write.

## Interface

All JSON except the file read (`text/markdown`); every route follows the session
guard; errors use the server's standard body.

| Method and path               | Purpose                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/memory/file`        | The file itself — the page's raw view                                                                     |
| `GET /api/memory/off-record`  | The off-record flag                                                                                       |
| `POST /api/memory/off-record` | Set the flag                                                                                              |
| `POST /api/memory/reset`      | Clear the book to empty → `{reset_at}` (maintenance write: not off-record-gated; works on a corrupt file) |

| Failure                               | Answer                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| shape or value violates format        | `400 INVALID_ENTRY`                                             |
| no matching entry (concurrent change) | `404 ENTRY_NOT_FOUND`                                           |
| several hits / duplicate lines        | `409 AMBIGUOUS_ENTRY` (candidates in message)                   |
| identical line already stored         | `409 DUPLICATE_ENTRY`                                           |
| cap reached                           | `409 LIMIT_REACHED` (该忘点什么？)                              |
| MEMORY.md unparseable                 | `500 MEMORY_FILE_INVALID` (fix by hand, or reset from the page) |

## Invariants

1. One write = one validated, atomic full-file replace; there is no partial
   write and no second storage.
2. The parser is part of validation; anything that does not parse is refused,
   never repaired.
3. Every landed change leaves a receipt quoting the file's own lines;
   replacement never coexists with the old line.
4. Expired entries appear in no prompt and no lookup; on the page they are the
   file's own lines.
5. The tools are the only programmatic write path, and they refuse while the
   conversation is off the record; hand edits of the file and the page's reset
   are the human write paths.
6. The AI never sees a file path; the tool boundary is the whole surface.

## Out of scope (for now)

- Retrieval of any kind — the book is always open; no vectors, no embeddings,
  no index to query.
- Per-domain prompt scoping (feeding a section only to one domain's agents):
  revisit when a second writing domain lands and prompt cost or noise demands it.
- A veto ledger or per-topic bans: deletion deletes; re-learning is answered by
  visibility (receipts) and the one-sentence delete, not prevention.
- Per-entry scopes or sources; a database adapter (the port leaves the door
  open).
- Page-side editing: the page is read-only by design — a chat sentence or a
  hand edit is the editor; the form-era page and its write routes were deleted,
  not mothballed.
