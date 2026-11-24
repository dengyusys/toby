# Grilling

English | [简体中文](grilling.zh.md)

> **Source**: [mattpocock/skills](https://github.com/mattpocock/skills), files
> `skills/productivity/grilling/SKILL.md` and
> `skills/productivity/grill-me/SKILL.md` — MIT License, Copyright (c) 2026
> Matt Pocock. Adapted on 2026-11-24: the two upstream skills are merged (the
> entry paragraph below is what `grill-me` contributed); the body otherwise
> follows upstream. This adapted copy is authoritative here. The Chinese
> mirror is a translation; the English text prevails.

Interview the user relentlessly until you reach a shared understanding. Map
the work as a **design tree**: every decision branches into the decisions
that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose
prerequisites are already settled: the questions you can ask _now_ without
guessing at answers you haven't heard yet. Ask the whole frontier in one
round: number each question and give your recommended answer. Then wait for
the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the
frontier outward and unblock questions that depended on them. Recompute the
frontier and ask the next round. A question whose answer depends on another
question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs
a fact from the codebase or environment, dispatch a sub-agent with a fresh
context window to find it; don't ask the user for anything you could look up
yourself. Don't block on it: a running exploration is an unsettled
prerequisite, so only the questions downstream of it wait for the sub-agent
to report; ask the rest of the frontier now. The _decisions_ are the user's:
put each to them and wait.

The session is done when the frontier is empty: every branch of the design
tree visited, nothing left silently assumed. Do not act on it until the user
confirms you have reached a shared understanding.

**Entry.** The user saying "grill me" — or asking to stress-test a plan,
decision, or idea before you draft anything — starts this protocol.
