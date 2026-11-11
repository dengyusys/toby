# Long-Term Memory: One Markdown File

English | [简体中文](memory-markdown-file.zh.md)

Toby gains long-term memory: one Markdown file — `data/memory/MEMORY.md` — holding a small, governed set of entries the user explicitly asked to keep. Every agent's prompt carries the sections its domain needs; every change, spoken or hand-edited, is one validated write with a receipt. The design follows Today's article [个人智能体应该记住什么?](https://today.ai/articles/zh-Hans/blog/what-should-ai-agent-remember) ("what should a personal agent remember?"): memory needs rules, not just capacity — the hard part is selection and control.

## Why

- **The product promise is concrete.** "It remembers your preferences and habits, and gets handier the longer you use it" — for a one-sentence interface, handier means the same thing can be said shorter next time and still land right. Memory is what turns a one-off correction into a standing convention:

  ```text
  你:咖啡 18             → 已记入:餐饮 ¥18
  你:不对,咖啡记饮品     → 已修改:餐饮 → 饮品
  你:以后都这样           → 记住了:〔约定〕咖啡记「饮品」
  (之后)你:咖啡 20      → 已记入:饮品 ¥20
  ```

  The correction fixed one row; the convention makes the same correction unnecessary. Same for 打车都备注报销, 「老规矩早餐」= 15 元, 小王是房东.

- **The governance rules are promises Toby already makes.** Writes in plain sight (receipt cards), unclear sentences get questions instead of guesses, and the AI cannot act on its own. The reference article states the same rules as memory design: an entry needs a subject, a source, a status, a time, a scope, a retention rule, and an action impact — selection and control over capacity.
- **Markdown is the store, because this is the one data the user must be able to read and edit as plain text.** Same stance as [Claude Code](https://code.claude.com/docs/en/memory) and [OpenClaw](https://docs.openclaw.ai/concepts/memory): plain files are the source of truth, and what is on disk is what the model knows — no hidden state.

## Four layers — Toby already has three

| Layer            | In Toby                                                                                                                                | Status             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Current context  | the user's sentence (and the classifier's folded version) plus today's date                                                            | exists             |
| History          | the turns in `chat.db`; only the last four exchanges within six hours replay                                                           | exists             |
| Task state       | **the business domains themselves** — ledger rows, (upcoming) schedule, todos, notes; each with its own lifecycle, store, and receipts | landing one by one |
| Long-term memory | `data/memory/MEMORY.md`                                                                                                                | this decision      |

The boundary falls out of the table:

- Ongoing goals, commitments, and action outcomes belong to **domains**: a todo has a completion state, a schedule entry has a time, a ledger row _is_ the outcome. Memory that duplicated them would become the article's "old items with the power to interrupt".
- Verbatim records belong to notes.
- Memory holds only the **stable background no domain owns** — the context that shapes how every domain reads a sentence.

## An entry: seven fields, three kinds

| Field         | In Toby                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Subject       | the kind separates "me" from "people"; a people entry starts with the person's name                                                     |
| Source        | an entry exists only because the user said so; claims about others keep their attribution (「小王说…」)                                 |
| Status        | convention (an instruction) or fact. **Inferences are never stored** — the agent may ask 要我记下来吗?, and only an explicit yes writes |
| Time          | every entry carries its last-confirmed date                                                                                             |
| Scope         | the kind decides which domains see it                                                                                                   |
| Retention     | open-ended, or `至` a date                                                                                                              |
| Action impact | decided by the kind (below)                                                                                                             |

| Kind               | Reference category                                    | Example                                               | Retention                                                            | Action impact                                                  | Who sees it                          |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| 约定 (conventions) | corrections & ways of working — explicit instructions | 咖啡记「饮品」;打车备注「报销」;「老规矩早餐」= 15 元 | until the user changes it                                            | **may shape a write draft — obeyed**                           | every domain + the intent classifier |
| 关于我 (about me)  | stable preferences & constraints — confirmed facts    | 不吃香菜;回答要简短;每月 10 号发工资                  | a contradicting sentence wins, then the agent asks whether to update | informs answers only                                           | chat (and, later, greeting)          |
| 人物 (people)      | relationship info with clear provenance               | 小王:房东;妈妈:生日 3 月 12 日                        | verbatim, never expanded into a profile                              | helps interpretation (category, note) — never amounts or dates | chat, ledger                         |

**A convention is obeyed; a fact only informs.** Amount, date, and entry type come from the sentence alone, unless a convention explicitly defines them (「老规矩早餐」). When the sentence and a convention conflict, the sentence wins for that write. Validation and receipts stay exactly as they are — memory is not permission.

Any entry may carry an expiry — the article's temporary states: 「出差上海期间,餐饮记「差旅」(至 2026-11-30)」. An expired entry stops being injected and shows on the memory page as expired, waiting for renewal or deletion. Nothing is dropped silently.

The file itself — headings are the product's own language:

```markdown
## 约定

- 咖啡记「饮品」 (2026-11-11)
- 出差上海期间,餐饮记「差旅」 (2026-11-03,至 2026-11-30)

## 关于我

- 不吃香菜 (2026-11-11)

## 人物

- 小王:房东 (2026-09-15)
```

## One file — and the day it splits

- The whole file is injected by kind; there is no retrieval, so splitting buys nothing. Kinds are sections, not files, because visibility is cross-cutting: 人物 is read by both chat and ledger.
- The reference systems that use several files have axes Toby lacks: Claude Code spans organization, project, and user scopes and accumulates automatically; OpenClaw keeps append-only daily notes and curates long-term memory from them; [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) splits the agent's notes from the user profile. Toby is single-user, single-instance, explicit-only.
- **Split condition, recorded not built:** when unattended distillation lands, or the cap grows past what full injection justifies, split into an always-injected curated file plus on-demand long-tail files. Today's sections are that seam.
- No change-log file: chat writes leave receipt cards; recovery is backup — the standing no-undo decision ([system-overview](../system-overview.md)).

## What is never stored

- **Credentials** — passwords, verification codes, payment details. Refused with an explanation: memory rides to the model provider on every agent run, so it must never hold secrets.
- **Unconfirmed inferences.**
- **Open-ended temporary states** — the agent asks 记到什么时候? first.
- **What a domain owns** — deadlines, todos, ledger entries.
- **Sensitive self-descriptions** are stored verbatim, never rewritten into labels.

## The user stays in charge

- **See** the real entries — the page shows the file (kind, date, validity), not a summary; asking 你记得我什么 lists entries verbatim.
- **Correct** with one sentence, two semantics handled apart: 现在变了 (replace, refresh the date) versus 从来不对 (delete). Ambiguity gets a question, never a guess.
- **Trace** every change: chat writes leave receipt cards, changes show before/after. No in-product undo; recovery is backup.
- **Opt out** by saying nothing: nothing is stored unless asked.

## Mechanics

- One file, three fixed sections, a 4,000-character cap. Full means refusal plus a question about what to forget — curation by design, never silent summarizing.
- Every write — the extraction agent's or a manual save — passes the same deterministic validation, then replaces the file atomically. One write, all or nothing, like every other domain. This is the first non-database store: the exception to [one database per domain](db-adapter.md) is recorded here.
- The write path mirrors ledger: intent routing ([chat-domain-capabilities](chat-domain-capabilities.md)) → a typed draft (kind, text, until — or the entries to forget) → validation → one atomic replace → receipt card.
- The read path: the composition root hands each domain the kinds it needs; the runtime renders them as a `<memory>` section of that domain's agent prompt ([ai-pi-runtime](ai-pi-runtime.md)); the intent classifier sees conventions only. An unreadable file degrades to "no memory" for agents — a memory fault never breaks a domain — while the page reports the error honestly.

## Deliberately not in v1

- **Unattended auto-writes** — a noticed pattern is proposed, never stored.
- **Reconfirmation nudges** — a natural job for the greeting domain later.
- **Retrieval / semantic search.**
- **Audience isolation** — single user, single audience; reopened if Toby ever writes for third parties.

## The nine-question check

The article's acceptance test, answered for Toby:

| #   | Question                                              | Toby's answer                                                                                                     |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | See actual entries, not a model summary?              | yes — the page and 你记得我什么 both show entries verbatim                                                        |
| 2   | Source and last-confirmed time?                       | source is always the user's explicit words; every entry carries its last-confirmed date                           |
| 3   | Mark temporary, set expiry, limit scope?              | expiry yes (至 a date); scope is by kind, not per entry                                                           |
| 4   | Correct, and the old version stops applying?          | replacement, never coexistence                                                                                    |
| 5   | Delete, including the sources?                        | the entry goes; the chat turn stays (history is a separate, visible layer) — no other store exists                |
| 6   | A conversation that never enters memory?              | inherent — nothing is stored unless asked                                                                         |
| 7   | Work/family/people isolation?                         | people entries are separate by subject; per-domain visibility by kind; no other contexts exist yet                |
| 8   | Explain when a memory influenced an answer or action? | partial — receipts show what landed; the traces monitor shows each run's full prompt, `<memory>` included         |
| 9   | Does acting still require permission?                 | memory never initiates or authorizes a write; a convention only shapes the draft of a sentence the user just said |

## Testing

The house regime: temp data roots, scripted AI — no real model, production `data/` untouched. A live-model run (remember → use → correct → forget) is a manual step with explicit authorization, reported separately.
