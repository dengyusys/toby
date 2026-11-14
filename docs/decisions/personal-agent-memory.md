# Personal Agent Memory

English | [简体中文](personal-agent-memory.zh.md)

Toby is a personal butler, and a butler's memory is alive: it learns without being asked (that is silent learning), forgets what stops being true, and reports every change. One principle governs the whole domain — **the AI may remember and may forget, but every change leaves a receipt (a small card stating what changed), and the user can veto — rewrite or delete — any entry with one sentence.** Storage is one strictly parsed Markdown file behind a repository port, organized into open topic sections, all equal. How it is read is one rule: **the whole book is always open** — every entry, every section, in every agent's prompt, bounded by the cap.

> Revision 3 (this document) replaces the three fixed types (约定 / 关于我 / 人物) and the layered reading (full conventions + index + recall) with open sections and the whole-book rule. The driver: the three cells were consumption policies, not content categories — domain knowledge (转账规矩, 工作惯例, 健康) had no home, and the layers could not grow. The whole book is the simpler mechanism that grows by itself.
>
> Revision 4 cuts the page's write buttons. The page becomes a read-only view of the file itself — the raw Markdown source — plus one maintenance control, 重置, the two-step empty-the-book reset. Writes converge to two paths, each honest about its actor: the AI writes through tools (off-record gate, receipt); the human writes by hand-editing the file, where the diff is the receipt. A page of inline editors was a database table in a memo's clothes; its REST write routes were deleted, not mothballed.

## Why

- **The positioning demands living memory.** The user's own words: 更重要是可以忘记或删除失效记忆 — updating is only the baseline; _forgetting_ is the feature. A memory that only accumulates is an archive; a butler prunes.
- **The branch's first draft was explicit-only** — nothing stored unless the user asked, metadata modeled on the Today article's governance framework. It read like a configured tool, not a butler: never learning unless taught. That draft is replaced by this one. Of the article's seven metadata fields only the four carrying a mechanism survive (mapping below); source, status, and per-entry time deliberately do not — an entry does not need to record where it came from, and silent learning is accounted for by the receipt and the traces at the moment it happens, not by in-file bookkeeping.
- **Revision 3's driver: memory must grow by domain.** The fixed three types answered "who sees this entry" but not "what is this about" — a rule about reimbursements, a fact about the user's schedule, a person's role in transfers all had to squeeze into cells named for consumption tiers. The product direction the user set: sections appear as conversations touch new domains (转账, 工作, 健康), the file organizes itself by topic, and no code changes when a new domain of life shows up.

## The governance model

| Act            | Who initiates it                                                  | What the user sees                                                               |
| -------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| learn          | the agent, without being asked, mid-conversation                  | 已记住:咖啡记「饮品」                                                            |
| update         | a contradicting sentence, or the agent noticing one               | receipt with before/after — replace, never coexist                               |
| forget         | expiry (`至` a date), the user's sentence, or the agent's cleanup | 已清理:出差上海记「差旅」(已过期 10 天)                                          |
| veto           | the user, always                                                  | one sentence rewrites or deletes anything; a hand edit of the file does the same |
| reset          | the user, from the page                                           | the book empties in one atomic write (`{reset_at}`); not off-record-gated        |
| off the record | the user — one sentence (这通别记) or a page toggle               | the policy gate rejects every remember / forget call in that session             |

The middle option — notice and ask, 要我记下来吗? — was rejected: a confirmation gate exists nowhere else in this product, and the butler's posture is 我记下了, not 我可以记吗. The cost is accepted knowingly: a wrongly learned entry influences the next write until struck out. The safety nets are receipts (every change visible), the one-sentence veto, and the page.

**Deletion deletes; it does not ban.** Silent learning means an entry deleted today can be re-learned next month when the same pattern recurs — and nothing hidden prevents that, deliberately. A veto ledger was considered and dropped: it would be the product's only piece of invisible permanent state, and it could not keep its promise anyway — exact matching is evaded by paraphrase (不吃香菜 → 讨厌香菜), semantic matching needs the retrieval infrastructure this design rejects. The defenses are the ones the product already trusts: every re-learn leaves a receipt, and one sentence deletes it again. "Stop noticing this at all" is the off-record flag's job; a per-topic block waits for a first observed delete-and-relearn loop.

## The entry: open sections, one line each

```markdown
## 约定

- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 2026-11-30)

## 关于我

- 不吃香菜

## 转账

- 给小王的转账走「人情往来」

## 工作

- 公司报销必须要有发票

## 人物

- 小王:房东
```

Format: `## <topic>` headings, each followed by one-line entries; one optional trailing marker, `(至 date)`, and nothing else. `约定`, `关于我`, `人物` are not special — they are simply the topics the first writes produced, kept as house vocabulary. People entries keep the `名字:描述` shape as house style, not syntax. The parser is deterministic and part of validation — a line that does not parse rejects the write. Section names are free (non-empty, short, unique in the file); a duplicate heading is invalid — merge instead.

| Field | Where it lives                                                    |
| ----- | ----------------------------------------------------------------- |
| topic | the section heading — what this entry is about                    |
| text  | the line body, one sentence                                       |
| until | `(至 date)` — expiry; an expired entry stops appearing everywhere |

Status, origin, per-entry dates, and id deliberately do not land — an entry does not need to record where it came from to be valid. The file keeps only markers carrying a mechanism: without until there is no deterministic forgetting; accountability and freshness are handled on the spot by the learn-time receipt and the traces — in-file bookkeeping is insurance for a three-days-later question, maintained forever. The cost is accepted knowingly: an entry you never taught it no longer links back to the conversation where it was learned — paging through chat history is the only way — and its age is invisible.

Events (已发生事件) are not a topic — notes and chat history own events; memory holds only the stable background no domain owns. A future domain (schedule, notes) that needs its own records keeps its own database; the topics here are background knowledge, not ledgers.

## Storage: one strict Markdown file, behind a port

- `data/memory/MEMORY.md` remains the one non-database storage — the recorded exception to [one database per domain](db-adapter.md) — now with an exit path.
- **The repository port comes first.** Domain code (service, tools, validation, receipts) compiles against the repository, the same word chat and ledger already use; the Markdown file is its only implementation today, and a database adapter can later replace it in the composition root, touching no domain code.
- **The strict format is the migration path.** The future db import is a one-time parse → build → count-check — feasible only because every line parses.
- One write = one full-file atomic replace (temp file + rename). Hand edits are welcome — directly on disk — but a file that no longer parses is refused, never silently repaired.
- There is no export feature: the page already shows the file itself, and a backup is a copy of the file on disk (the user owns the server). No second file mirrors the storage — a synced export would become a second source of truth, and hand-edits to it would be wiped by the next write.

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

## How it is read: the whole book, always open

One rule, no layers: **every non-expired entry of every section is written into the `<memory>` prompt section of every agent — chat, every database-writing extractor, the intent classifier, the memory agent — resolved fresh on each run.** The butler carries the entire notebook on every errand, the way a person does.

```text
<memory>
## 约定
- 咖啡记「饮品」
- 出差期间餐饮记「差旅」 (至 11-30)

## 关于我
- 不吃香菜

## 转账
- 给小王的转账走「人情往来」

## 人物
- 小王:房东
</memory>
```

Why the layers were dropped, and what the whole-book rule costs:

- **The layers were consumption tiers pretending to be content categories.** 约定-in-full existed to prevent the silent wrong write (a missed convention); the index-plus-recall tail existed to keep prompts small. But tiers cannot grow — every new topic would need a tier policy — and the model, not the file, is the one deciding relevance anyway.
- **Presence is now strictly stronger.** Today only conventions reach a write path; with the whole book open, a write agent also sees 人物 and 转账 and 健康 while it writes. The silent-wrong-write class loses its cause, not just its example. The name-hit injection mechanism (literal lookup of remembered names in the sentence) is retired for the same reason — the names are already in the prompt, hit or not.
- **`recall` is retired.** The tool existed to page through a book the prompt only indexed; with the book in hand it has nothing to fetch. 你记得我什么 is answered verbatim from the section the model is looking at. No retrieval infrastructure remains — the model is the retriever, and now also the page.
- **The costs, accepted knowingly:** prompt tokens grow with the book (~20 tokens per entry; 100 entries ≈ 2K, the 500 cap ≈ 10K), paid on every run including the intent classifier; a stable prefix lets provider prompt caching absorb most of it. Irrelevant lines ride along — each entry is one self-describing line, so the noise is bounded, and misapplication (a transfer rule whispered during bookkeeping) is the model's failure to ignore, visible in traces and correctable by the one-sentence veto. The cap graduates from "plenty" to "the actual bound on the book" — a full file means refusal plus 该忘点什么, never silent truncation, never summarization.
- Expired entries appear in no prompt; on the read-only page they are simply the file's lines, awaiting renewal or deletion.
- A corrupt file degrades the section to a visible placeholder （记忆文件当前无法读取）— chat keeps working, memory stays visibly broken.

## How it is written

- Three tools: `remember` / `forget` (write-intent) and `off_record`. Which agents carry them follows one line: every conversational agent (chat, ledger, and notes/todo when they land) carries remember and forget — the typical place a rule is learned is a correction during bookkeeping (coffee refiled under 「饮品」) — while `off_record` stays on the memory domain's own agent for the explicit 这通别记 / 可以记了 sentences. One-off callers like the intent classifier get the `<memory>` section and no tools. The policy gate and the receipts act on the tool, not on which agent calls it.
- Writes converge on two paths, and only two: the AI writes through the tools (off-record gate, receipt); the human writes by hand-editing the file — or by resetting it from the page, one atomic empty-file write, not off-record-gated, allowed even on a corrupt file (explicit discard is a recovery path, never silent repair). The page's own form-era write endpoints were deleted rather than kept without a consumer.
- **Choosing the section is the model's first judgment:** prefer an existing section the entry plainly belongs to; open a new one only when nothing fits; the user's explicit instruction (记到「工作」里) always wins. Section sprawl (转账 vs 金钱) is the accepted failure mode — a hand edit is the cure, and the prompt guidance keeps it rare.
- Every write: deterministic validation (format, 至 dates, replace-vs-duplicate, section-name rules, cap) → one atomic storage write → receipt card, before/after on updates. The receipt reuses the existing card components; nothing new is invented.
- Locating the old line: an update or delete carries no old-line quote and no id — it carries one keyword, substring-matched over all non-expired entry texts. Exactly one hit → replace or delete; several → refuse and list the candidates (if it cannot be resolved, ask — never guess); zero → forget answers "nothing on that", a remember-with-replace treats it as a new append. A remember without a replace keyword is a pure append, checked for duplicates across the whole book — identical text anywhere answers "already remembered: X". The receipt's before/after is simply the hit line and the new line.
- A cap of 500 entries as the hard limit: full means refusal plus a question about what to forget.
- Explicit memory sentences (记住X / 忘掉X / 你记得我什么) route to the memory domain like any other [chat capability](chat-domain-capabilities.md); silent learning needs no routing — the tools ride whichever agent is already running.

## The memory page

The butler's memo, not a database table — the page renders `MEMORY.md` itself: the raw Markdown source, monospace, file order, exactly the file on disk; an empty file reads as the empty state, a corrupt one as the honest error. Nothing on the page edits anything: changes are a chat sentence or a hand edit of the file. Two controls remain — the memory toggle (开启记忆 / 关闭记忆; the "page toggle" in the governance table: while it is off, every `remember` / `forget` call in the current session is rejected by the policy gate) and 重置: a two-step confirm — entry count, irreversibility warning — that clears the book to empty in one atomic write, allowed even when the file is corrupt.

## The nine-question check

The article's acceptance test, answered for this design — and re-answered, because open sections change two of the answers:

| #   | Question                                              | Answer                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | See actual entries, not a model summary?              | yes — the page shows MEMORY.md's raw source verbatim; 你记得我什么 lists entries verbatim from the open book                                                                             |
| 2   | Source and last-confirmed time?                       | partial — the learn-time receipt shows it as it happens; no source links or timestamps live in the file; tracing back later means paging through chat history                            |
| 3   | Mark temporary, set expiry, limit scope?              | expiry yes (至); scope is by topic section — the section is the scope, and sections are free                                                                                             |
| 4   | Correct, and the old version stops applying?          | replacement, never coexistence; receipts show before/after                                                                                                                               |
| 5   | Delete, including the sources of regeneration?        | deletion yes, regeneration not blocked — the same pattern can re-learn it; visibility (every re-learn leaves a receipt) plus the one-sentence delete, not prevention                     |
| 6   | A conversation that never enters memory?              | yes — the session flag (one sentence or the page toggle) makes the policy gate reject every remember / forget call                                                                       |
| 7   | Work/family/people isolation?                         | single user, single context, by design; topics are the grouping, and the user names them                                                                                                 |
| 8   | Explain when a memory influenced an answer or action? | partial — traces show each run's full prompt live, memory included, but are deliberately not stored; receipts imply the influence (记入「饮品」 you never said) without explaining it    |
| 9   | Does acting still require permission?                 | memory never initiates or authorizes a write; every write stays deterministic validation + one transaction + a receipt — validation instead of approval, the product's consistent stance |

## References

- [What should an AI agent remember?](https://today.ai/articles/zh-Hans/blog/what-should-ai-agent-remember) (个人智能体应该记住什么?)
