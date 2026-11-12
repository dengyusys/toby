# Personal Agent Memory

English | [简体中文](personal-agent-memory.zh.md)

Toby is a personal butler, and a butler's memory is alive: it learns without being asked, forgets what stops being true, and reports every change. One principle governs the whole domain — **the AI may remember and may forget, but every change leaves a receipt, and the user can veto any entry with one sentence.** Storage is one strictly parsed Markdown file behind a `MemoryStore` port; the read path is tiered by the cost of forgetting: conventions live permanently in every agent's mind, while people and facts are a resident index plus on-demand recall.

## Why

- **The positioning demands living memory.** The user's own words: 更重要是可以忘记或删除失效记忆 — updating is table stakes; _forgetting_ is the feature. A memory that only accumulates is an archive; a butler prunes.
- **The branch's first draft was explicit-only** — nothing stored unless the user asked, metadata modeled on the Today article's governance framework. It read like a configured tool, not a butler: never learning unless taught. That draft is replaced by this one. The article's per-entry metadata survives (mapping below) and turns from decoration into load-bearing structure: under silent learning, 来源 and 状态 finally do work.
- **The standing write rules bend nowhere.** Every memory change is still deterministic validation plus one atomic store write, through a write-intent tool, with a receipt. What changes is only the trigger — an agent's own observation instead of the user's sentence — and the accountability, which moves from a confirmation gate to the receipt.

## The governance model

| Act            | Who initiates it                                                  | What the user sees                                                                           |
| -------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| learn          | the agent, unbidden, mid-conversation                             | 已记住:咖啡记「饮品」                                                                        |
| update         | a contradicting sentence, or the agent noticing one               | receipt with before/after — replace, never coexist                                           |
| forget         | expiry (`至` a date), the user's sentence, or the agent's cleanup | 已清理:出差上海记「差旅」(已过期 10 天)                                                      |
| veto           | the user, always                                                  | one sentence rewrites or deletes anything — and the deletion sticks (the veto ledger, below) |
| off the record | the user — one sentence (这通别记) or a page toggle               | the policy gate rejects every remember / forget call in that session                         |

The middle option — notice and ask, 要我记下来吗? — was rejected: a confirmation gate exists nowhere else in this product, and the butler's posture is 我记下了, not 我可以记吗. The cost is accepted knowingly: a wrongly learned entry influences the next write until struck. The safety nets are receipts (every change visible), the one-sentence veto, and the page.

**The veto is permanent.** Silent learning makes deletion half a verb: an entry deleted today can be re-learned next month when the same correction pattern recurs. So a user deletion also writes a veto-ledger entry (internal store state — never injected, never rendered as memory), and the learning path validates against it: a candidate that hits the ledger is refused, and re-learning requires the user's explicit sentence. Forgetting's mirror image is not re-learning.

## The entry: three kinds, one line each

```markdown
## 约定

- 咖啡记「饮品」 [2026-11-11]
- 出差期间餐饮记「差旅」 [2026-11-03 至 2026-11-30]

## 关于我

- 不吃香菜 [2026-11-11]
- 在减脂 [2026-11-08 待确认 源#3f2a]

## 人物

- 小王:房东 [2026-09-15]
```

Grammar: one entry per line; `[date]` mandatory; `至 date`, `待确认`, and `源#ref` optional markers; 人物 lines start with `name:`. The parser is deterministic and part of validation — a line that does not parse rejects the write.

| Field   | Where it lives                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kind    | the section heading — encodes potency and audience (below)                                                                                                                |
| status  | the `待确认` marker; absent = confirmed                                                                                                                                   |
| subject | 人物: the leading name; 关于我: the user; 约定: the rule itself                                                                                                           |
| text    | the line body, one sentence                                                                                                                                               |
| time    | `[date]` — the last confirmation                                                                                                                                          |
| until   | `至 date` — expiry; an expired entry stops appearing everywhere                                                                                                           |
| origin  | `源#ref` — a short chat-item reference the page renders as a jump back to the conversation that taught it. Mandatory on silently learned entries, absent on explicit ones |
| id      | none — full-file atomic replace needs no ids                                                                                                                              |

Status does not gate potency: a silently learned 约定 takes effect immediately — that is the point of silent learning. It gates display (a 待确认 badge on the page) and the forgetting policy (the agent may cull unconfirmed inferences more aggressively than confirmed facts).

| Kind   | Potency                                                                                       | Who sees it                         |
| ------ | --------------------------------------------------------------------------------------------- | ----------------------------------- |
| 约定   | **obeyed** — may shape a write draft (咖啡→饮品); the sentence at hand still wins on conflict | every write domain + the classifier |
| 关于我 | informs answers only                                                                          | chat                                |
| 人物   | informs interpretation (小王=房东); never amounts or dates on its own                         | chat + ledger                       |

The article's seven metadata fields map cleanly: 主体→kind+subject, 来源→origin (attribution of hearsay stays in the text, 小王说他…), 状态→status, 时间→date, 范围→kind's audience, 保留→until + the cleanup right, 行动影响→potency. Events (已发生事件) are not a kind — notes and chat history own events; memory holds only the stable background no domain owns.

## Storage: one strict Markdown file, behind a port

- `data/memory/MEMORY.md` remains the one non-database store — the recorded exception to [one database per domain](db-adapter.md) — now with an exit path.
- **The `MemoryStore` port comes first.** Domain code (service, tools, validation, receipts) compiles against the port; the Markdown file is its only implementation today, and a database adapter can later replace it in the composition root, touching no domain code.
- **The strict grammar is the migration.** The future db import is a one-time parse → build → count-check — feasible only because every line parses.
- One write = one full-file atomic replace (temp file + rename). Hand edits are welcome — through the page's editor or directly on disk — but a file that no longer parses is refused, never silently repaired.
- Export from the page is an on-demand `.md` snapshot. No resident projection file: a synced shadow would become a second source of truth, and hand-edits to it would be clobbered by the next write.

## The read path: tiered by the cost of forgetting

Sort entries by how often they matter: conventions are the head — few, each load-bearing; people and facts are the long tail — each rare, the total unbounded. Mechanism strength is matched to failure cost:

| Layer                   | Mechanism                                                                                            | Why this, not more or less                                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 约定                    | **full injection** into every write domain's prompt and the intent classifier                        | A missed convention is a silent wrong write — validation passes, the receipt prints, nobody knows. Paraphrase (拿铁 for 咖啡) is bridged only by a model with the convention in context; a query it must formulate finds nothing. Bounded by the cleanup right, so permanence costs a few lines |
| 人物, on the write path | **deterministic pre-fetch**: the sentence's tokens are matched against parsed entries, hits injected | Names are exact tokens — lexical match almost never misses; zero model cost, zero extra round-trips                                                                                                                                                                                             |
| 人物 + 关于我, in chat  | **resident index + recall tool**                                                                     | Progressive disclosure: the manifest stays in the prompt, bodies load on demand — the same pattern as the skills the runtime already uses (name+description resident, SKILL.md on demand)                                                                                                       |

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

- `recall` is a read-only tool — keyword match over the parsed entries. No vectors, no retrieval infrastructure: the model is the retriever, the tool is the page-turning. Its prompt snippet is written as routing information (when to use it), in the spirit of a skill's description, not a bare label.
- Expired entries appear nowhere: not injected, not pre-fetched, not recalled. The page sinks them to the bottom, dated, awaiting renewal or deletion.
- **No forced gate.** A policy rejecting `submit_entries` until a recall happened would guarantee the act of recall but not its aim, at one extra model round-trip per write. Traces already record recall calls; the first observed missed-recall case decides which agent, if any, earns a gate.

## The write path

- Three tools: `recall` (read-only) and `remember` / `forget` (write-intent). The chat agent's policy widens from read-only to read-only + memory write — the first non-ledger write-intent agent.
- Every write: deterministic validation (grammar, dates, replace-vs-duplicate, cap, the veto ledger) → one atomic store write → receipt card, before/after on updates. The receipt rides the existing card machinery; nothing new is invented.
- A cap backstop on the order of a few hundred lines: full means refusal plus a question about what to forget — never silent truncation, never summarization.
- Explicit memory sentences (记住X / 忘掉X / 你记得我什么) route to the memory domain like any other [chat capability](chat-domain-capabilities.md); silent learning needs no routing — the tools ride whichever agent is already running.

## What is never stored

- **Credentials** — passwords, codes, payment details. Memory rides to the model provider on every run; it must never hold secrets.
- **Events and verbatim records** — notes and chat history own them.
- **What a domain owns** — deadlines, todos, ledger rows; memory that duplicated them would become old items with the power to interrupt.

## The memory page

A Markdown document grouped by kind — the butler's memo, not a database table. Per entry: confirm (clears 待确认), edit, delete; expired entries sunk with their dates; 源# jumps to the teaching conversation; export as `.md`.

## The nine-question check

The article's acceptance test, answered for this design — and re-answered, because silent learning changes two of the answers:

| #   | Question                                              | Answer                                                                                                                                                                                 |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | See actual entries, not a model summary?              | yes — the page renders MEMORY.md itself; 你记得我什么 lists entries verbatim                                                                                                           |
| 2   | Source and last-confirmed time?                       | 源# jumps back to the teaching conversation; every entry carries its last-confirmed date                                                                                               |
| 3   | Mark temporary, set expiry, limit scope?              | expiry yes (至); scope is per kind, not per entry — per-entry scopes are deliberately not built                                                                                        |
| 4   | Correct, and the old version stops applying?          | replacement, never coexistence; receipts show before/after                                                                                                                             |
| 5   | Delete, including the sources of regeneration?        | deletion plus the veto ledger — a deleted entry cannot be silently re-learned; re-learning takes the user's explicit sentence                                                          |
| 6   | A conversation that never enters memory?              | yes — the session flag (one sentence or the page toggle) makes the policy gate reject every remember / forget call                                                                     |
| 7   | Work/family/people isolation?                         | single user, single context, by design; people are grouped by subject                                                                                                                  |
| 8   | Explain when a memory influenced an answer or action? | partial — traces show each run's full prompt live, memory included, but are deliberately not stored; receipts imply the influence (记入「饮品」 you never said) without explaining it  |
| 9   | Does acting still require permission?                 | memory never initiates or authorizes a write; every write stays deterministic validation + one transaction + a receipt — validation instead of approval, the product's standing stance |

## Deliberately not built

Periodic consolidation (the greeting domain's natural job, later) · per-entry scopes · semantic/vector retrieval · reconfirmation nudges · the forced recall gate.

## Testing

The house regime: temp data roots, scripted AI, production `data/` untouched. Grammar-parser unit tests; write-path tests through faux agents (learn → receipt; contradict → replace with before/after; expire → sink; over-cap → refuse and ask; veto → re-learning blocked; off-record session → tools rejected); per-kind assertions on injection, pre-fetch, and the index; a live-model remember → use → correct → forget pass is a manual, explicitly authorized step.

## References

- [What should an AI agent remember?](https://today.ai/articles/zh-Hans/blog/what-should-ai-agent-remember) (个人智能体应该记住什么?) — the seven-field per-entry metadata and the "selection and control over capacity" stance come from here. This ADR is closer to the article than the draft it replaces: silent learning with a 待确认 status is the article's 暂定推断 realized, where the explicit-only draft had ruled it out.
