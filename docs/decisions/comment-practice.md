# How to Write Code Comments

English | [简体中文](comment-practice.zh.md)

**Write the comment the code cannot.** The machine never reads comments —
people and AI do. And nothing checks a comment: broken code fails a test, a
wrong comment fails nothing. So every comment is either earning its line or
rotting in place.

## Before writing

Try, in order: **rename → narrow the type → restructure → add a test →
comment**. The comment is last because it is the only channel nothing
verifies.

Ask one question: _delete it — does the reader lose a fact they cannot get
back from the names and types right here?_ Yes → write it. No → don't.

## The six good comments

| Type      | Says                                                               | Example                                               |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Why       | the reason: constraint, trade-off, rejected path                   | `// retry once: the provider kills idle conns at 30s` |
| Invariant | the rule a future edit must not break                              | `// all rows land, or none do`                        |
| Contract  | what a caller can't guess: units, null, ordering, dedupe, one-shot | `/** amounts are integer cents; 0 is valid */`        |
| Warning   | the danger, and the cost of "fixing" it                            | `// WARNING: empty body must parse as {}`             |
| Location  | one line: what lives here, where the neighbors are                 | `/** SQL layer lives in repository.ts */`             |
| TODO      | deferred work with an owner                                        | `// TODO(#123): drop after v2 ships`                  |

Contract comments are judged from the signature alone. "You can read the
body" never deletes one — callers don't read bodies.

## The six bad comments

| Bad            | Looks like                 | Fix                                         |
| -------------- | -------------------------- | ------------------------------------------- |
| Restates       | `// increment i`           | delete; fix the name if it hurts            |
| Divider        | `// ===== config =====`    | split the file                              |
| History        | `// as the old parser did` | keep the still-true rule, cut the clause    |
| Provenance     | `// copied from project X` | restate the constraint; specs/RFCs may stay |
| Commented code | `// const x = ...`         | delete — that is version control's job      |
| Journal        | `// struggled here`        | delete                                      |

## The four rules

1. **Same commit** — code that falsifies a comment updates it, in the same
   commit. A contradicting comment is a defect.
2. **One home** — each fact lives at the boundary that enforces it; mirrored
   copies change together; "same as above" never.
3. **Evidence to delete** — name the signature, line, or test that carries
   the fact, or keep the comment.
4. **One line beats five** — attention is the budget.
