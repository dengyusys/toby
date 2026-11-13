# Personal Agent Memory

English | [简体中文](personal-agent-memory.zh.md)

Toby is a personal butler, and a butler's memory is alive: it learns without being asked (that is silent learning), forgets what stops being true, and reports every change. One principle governs the whole domain — **the AI may remember and may forget, but every change leaves a receipt (a small card stating what changed), and the user can veto — rewrite or delete — any entry with one sentence.** Storage is one strictly parsed Markdown file behind a repository port; how it is read is layered by the cost of forgetting: conventions sit permanently in front of every agent, while people and facts are an index plus on-demand recall.

## Why

- **The positioning demands living memory.** The user's own words: 更重要是可以忘记或删除失效记忆 — updating is only the baseline; _forgetting_ is the feature. A memory that only accumulates is an archive; a butler prunes.
- **The branch's first draft was explicit-only** — nothing stored unless the user asked, metadata modeled on the Today article's governance framework. It read like a configured tool, not a butler: never learning unless taught. That draft is replaced by this one. Of the article's seven metadata fields only the four carrying a mechanism survive (mapping below); source, status, and per-entry time deliberately do not — an entry does not need to record where it came from, and silent learning is accounted for by the receipt and the traces at the moment it happens, not by in-file bookkeeping.
- **The existing write rules do not bend.** Every memory change is still deterministic validation plus one atomic storage write, through a write-intent tool (a tool with write permission, checked by the policy gate), with a receipt. What changes is only the trigger — an agent's own observation instead of the user's sentence — and the accountability, which moves from a confirmation gate to the receipt.

## The governance model

| Act            | Who initiates it                                                  | What the user sees                                                           |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| learn          | the agent, without being asked, mid-conversation                  | 已记住:咖啡记「饮品」                                                        |
| update         | a contradicting sentence, or the agent noticing one               | receipt with before/after — replace, never coexist                           |
| forget         | expiry (`至` a date), the user's sentence, or the agent's cleanup | 已清理:出差上海记「差旅」(已过期 10 天)                                      |
| veto           | the user, always                                                  | one sentence rewrites or deletes anything; the page carries the same buttons |
| off the record | the user — one sentence (这通别记) or a page toggle               | the policy gate rejects every remember / forget call in that session         |

The middle option — notice and ask, 要我记下来吗? — was rejected: a confirmation gate exists nowhere else in this product, and the butler's posture is 我记下了, not 我可以记吗. The cost is accepted knowingly: a wrongly learned entry influences the next write until struck out. The safety nets are receipts (every change visible), the one-sentence veto, and the page.

**Deletion deletes; it does not ban.** Silent learning means an entry deleted today can be re-learned next month when the same pattern recurs — and nothing hidden prevents that, deliberately. A veto ledger was considered and dropped: it would be the product's only piece of invisible permanent state, and it could not keep its promise anyway — exact matching is evaded by paraphrase (不吃香菜 → 讨厌香菜), semantic matching needs the retrieval infrastructure this design rejects. The defenses are the ones the product already trusts: every re-learn leaves a receipt, and one sentence deletes it again. "Stop noticing this at all" is the off-record flag's job; a per-topic block waits for a first observed delete-and-relearn loop.

## The entry: three types, one line each

```markdown
## 约定

- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 2026-11-30)

## 关于我

- 不吃香菜
- 在减脂

## 人物

- 小王:房东
```

Format: one entry per line; one optional trailing marker, `(至 date)`, and nothing else; 人物 lines start with `name:`. The parser is deterministic and part of validation — a line that does not parse rejects the write.

| Field   | Where it lives                                                            |
| ------- | ------------------------------------------------------------------------- |
| type    | the section heading — decides what the entry does and who sees it (below) |
| subject | 人物: the leading name; 关于我: the user; 约定: the rule itself           |
| text    | the line body, one sentence                                               |
| until   | `(至 date)` — expiry; an expired entry stops appearing everywhere         |

Status, origin, per-entry dates, and id deliberately do not land — an entry does not need to record where it came from to be valid. The file keeps only markers carrying a mechanism: without until there is no deterministic forgetting; accountability and freshness are handled on the spot by the learn-time receipt and the traces — in-file bookkeeping is insurance for a three-days-later question, maintained forever. The cost is accepted knowingly: an entry you never taught it no longer links back to the conversation where it was learned — paging through chat history is the only way — and its age is invisible.

| Type   | What it does                                                                                  | Who sees it                                                                                        |
| ------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 约定   | **obeyed** — may shape a write draft (咖啡→饮品); the sentence at hand still wins on conflict | every database-writing domain + the intent classifier (decides which domain a sentence belongs to) |
| 关于我 | informs answers only                                                                          | chat                                                                                               |
| 人物   | informs interpretation (小王=房东); never amounts or dates on its own                         | chat + ledger                                                                                      |

Four of the article's seven metadata fields land: 主体→type + the name prefix, 范围→type decides who sees it, 保留→until + the cleanup right, 行动影响→what it does; who said it stays in the text (小王说他…). Events (已发生事件) are not a type — notes and chat history own events; memory holds only the stable background no domain owns.

## Storage: one strict Markdown file, behind a port

- `data/memory/MEMORY.md` remains the one non-database storage — the recorded exception to [one database per domain](db-adapter.md) — now with an exit path.
- **The repository port comes first.** Domain code (service, tools, validation, receipts) compiles against the repository, the same word chat and ledger already use; the Markdown file is its only implementation today, and a database adapter can later replace it in the composition root, touching no domain code.
- **The strict format is the migration path.** The future db import is a one-time parse → build → count-check — feasible only because every line parses.
- One write = one full-file atomic replace (temp file + rename). Hand edits are welcome — through the page's editor or directly on disk — but a file that no longer parses is refused, never silently repaired.
- Export from the page is an on-demand `.md` snapshot. No always-synced export file: it would become a second source of truth, and hand-edits to it would be wiped by the next write.

```text
apps/server/src/domains/memory/     # domain code: a vertical slice, no cross-domain imports
├─ plugin.ts                        # domain assembly: routes, tools, policy registration
├─ errors.ts                        # this domain's error codes (closed union)
├─ types.ts                         # pure types: entries, parse results
├─ parser.ts                        # line-by-line parse and serialize — deterministic, part of validation
├─ repository.ts                    # the repository: reads and validated writes of memory (the port)
└─ memory-file.ts                   # this domain's db.ts: the only file touching disk — reads and writes MEMORY.md, temp file + rename atomic replace

data/memory/
└─ MEMORY.md                        # the only storage; hand edits welcome, unparseable files are refused
```

## How it is read: layered by the cost of forgetting

Sort entries by how often they matter: conventions are the head — few, each load-bearing; people and facts are the long tail — each rare, the total unbounded. Mechanism strength is matched to failure cost:

| Layer                  | Mechanism                                                                                 | Why this, not more or less                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 约定                   | **written in full** into every database-writing domain's prompt and the intent classifier | A missed convention is a silent wrong write — validation passes, the receipt prints, nobody knows. Paraphrase (拿铁 for 咖啡) is bridged only by a model with the convention in context; a query it must formulate finds nothing. Held in check by the cleanup right, so being always present costs only a few lines |
| 人物, when writing     | **look up remembered names in the sentence**; attach the entries that hit                 | Names are exact tokens — a literal match almost never misses; no segmentation, no model cost, no extra round-trips; false hits (小王 inside 小王子) are accepted — telling them apart is the model's job                                                                                                             |
| 人物 + 关于我, in chat | **the index stays in the prompt; bodies are fetched with recall**                         | The same pattern as the skills the runtime already uses: the manifest stays in the prompt (name+description), the body loads on demand (SKILL.md)                                                                                                                                                                    |

The `<memory>` section every agent carries:

```text
<memory>
## 约定
- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 11-30)

## 记忆索引 — 详情用 recall 工具查询
人物: 小王、妈妈     关于我: 饮食、作息
</memory>
```

- `recall` is a read-only tool — keyword match over the parsed entries, deliberately dumb: substring hit, case-insensitive, matching names and entry text (type headers and 至 markers never match); every type is searchable; expired entries are never returned. Paraphrase (拿铁 for 咖啡) is the model's job — it re-queries with different words; the tool expands nothing. No vectors, no retrieval infrastructure: the model is the retriever, the tool just turns the pages. Its prompt snippet is written as routing information (when to use it), in the spirit of a skill's description, not a bare label.
- Expired entries appear nowhere: not written into prompts, not looked up, not recalled. The page lists them last, awaiting renewal or deletion.
- **No forced gate.** A policy rejecting `submit_entries` until a recall happened would guarantee the act of recall but not its aim, at one extra model round-trip per write. Traces already record recall calls; the first observed missed-recall case decides which agent, if any, earns a gate.

## How it is written

- Three tools: `recall` (read-only) and `remember` / `forget` (write-intent). Which agents carry them follows one line: every conversational agent (chat, ledger, and notes/todo when they land) carries all three — the typical place a convention is learned is a correction during bookkeeping (coffee refiled under 「饮品」) — while one-off calls like the intent classifier get the `<memory>` section and no tools. The chat agent's policy widens from read-only to read-only + memory write — the first non-ledger write-intent agent. The policy gate and the receipts act on the tool, not on which agent calls it.
- Every write: deterministic validation (format, 至 dates, replace-vs-duplicate, cap) → one atomic storage write → receipt card, before/after on updates. The receipt reuses the existing card components; nothing new is invented.
- Locating the old line: an update or delete carries no old-line quote and no id — it carries one keyword, searched with exactly recall's substring rule over names and entry text, non-expired entries only. Exactly one hit → replace or delete; several → refuse and list the candidates (if it cannot be resolved, ask — never guess); zero → forget answers "nothing on that", a remember-with-replace treats it as a new append. A remember without a replace keyword is a pure append, checked for duplicates first — identical text answers "already remembered: X". The receipt's before/after is simply the hit line and the new line.
- A cap of a few hundred lines as the hard limit: full means refusal plus a question about what to forget — never silent truncation, never summarization.
- Explicit memory sentences (记住X / 忘掉X / 你记得我什么) route to the memory domain like any other [chat capability](chat-domain-capabilities.md); silent learning needs no routing — the tools ride whichever agent is already running.

## The memory page

The butler's memo, not a database table — the page renders `MEMORY.md` itself, grouped by type, readable in one screen. Each entry can be edited or deleted; expired entries are listed last, awaiting renewal or deletion; the top bar exports an on-demand `.md` snapshot. The no-memory toggle lives here too (the "page toggle" in the governance table): while it is on, every `remember` / `forget` call in the current session is rejected by the policy gate.

## The nine-question check

The article's acceptance test, answered for this design — and re-answered, because silent learning changes two of the answers:

| #   | Question                                              | Answer                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | See actual entries, not a model summary?              | yes — the page renders MEMORY.md itself; 你记得我什么 lists entries verbatim                                                                                                             |
| 2   | Source and last-confirmed time?                       | partial — the learn-time receipt shows it as it happens; no source links or timestamps live in the file; tracing back later means paging through chat history                            |
| 3   | Mark temporary, set expiry, limit scope?              | expiry yes (至); scope is per type, not per entry — per-entry scopes are deliberately not built                                                                                          |
| 4   | Correct, and the old version stops applying?          | replacement, never coexistence; receipts show before/after                                                                                                                               |
| 5   | Delete, including the sources of regeneration?        | deletion yes, regeneration not blocked — the same pattern can re-learn it; visibility (every re-learn leaves a receipt) plus the one-sentence delete, not prevention                     |
| 6   | A conversation that never enters memory?              | yes — the session flag (one sentence or the page toggle) makes the policy gate reject every remember / forget call                                                                       |
| 7   | Work/family/people isolation?                         | single user, single context, by design; people are grouped by subject                                                                                                                    |
| 8   | Explain when a memory influenced an answer or action? | partial — traces show each run's full prompt live, memory included, but are deliberately not stored; receipts imply the influence (记入「饮品」 you never said) without explaining it    |
| 9   | Does acting still require permission?                 | memory never initiates or authorizes a write; every write stays deterministic validation + one transaction + a receipt — validation instead of approval, the product's consistent stance |

## References

- [What should an AI agent remember?](https://today.ai/articles/zh-Hans/blog/what-should-ai-agent-remember) (个人智能体应该记住什么?)
