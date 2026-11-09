# AI Coding Practice: Correctness as Continuous Maintenance

English | [简体中文](ai-coding-practice.zh.md)

> **Scope**: this repository — a solo-maintained, self-hosted project with AI agents in the coding loop.
> **Positioning**: this method as it lands in Toby. Every principle points at a structure that already exists in the repo; team-scale machinery (double review, canary rollouts, constraint-registry meetings) is out of scope. The operative rules for agents live in [AGENTS.md](../AGENTS.md); this document explains **why those rules are shaped the way they are**, and covers the practices not yet machine-enforced.

---

## 0. Problem statement

The problem of development is not "how to write correct code in one pass" — it is:

> **Under incomplete information, shifting requirements, and growing systems, keep making change decisions that are verifiable, revertible, and evolvable.**

AI changes the cost structure, not the problem:

|                         | Traditional                     | AI-assisted                                                                                    |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cost of generating code | High                            | Near zero                                                                                      |
| Cost of verifying code  | Medium                          | **The main bottleneck**                                                                        |
| Typical error shape     | Obvious errors: syntax, crashes | **Plausible-looking errors**: consistent style, thorough comments, compiles fine — wrong logic |
| Size of one change      | Bounded by human effort         | Easily unbounded; the agent "helpfully" refactors, rewrites wide areas                         |

So the center of gravity moves from "writing it right" to "**continuously proving it is still right**."

This sentence has an unusual footnote in this repository: the Toby product itself solves the same problem — its own AI makes constrained writes against user data every day. The product's answer (actions kernel, write tiers, tool safety kinds) and this document's answer for the development flow come from the same set of axioms. The correspondence is called out throughout.

---

## 1. Axioms and corollaries

### Axiom: correctness is a constraint maintained through every change

Correctness cannot be proved once and hold forever. Code, dependencies, data, requirements, and the runtime environment all change; the system drifts from expectations continuously. Correctness is maintained by feedback loops — one-shot proofs don't do it.

### Corollary 1: drive down the cost of each maintenance round

Since maintenance never stops, the strategy is to make errors surface **earlier, cheaper, and more reversibly**:

- **Earlier**: caught at decision time beats caught at review beats caught in production;
- **Cheaper**: low cost to find and fix, ideally automated — the repo's four checks (typecheck / lint / format / test) are this corollary in concrete form;
- **More reversible**: a fast path back to a known-good state — code via reverting single-intent commits, product data via the immediate tier's revert window.

### Corollary 2: recurring error classes are blocked by structure, not memory

The first occurrence of an error is incomplete information; the second occurrence of the same class is a design failure. A confirmed error must be converted into a structural constraint (see §6).

### Corollary 3: evidence must be independent of generation

(Specific to the AI era.) If code and its tests are produced by the same model in the same context, they **share the same misunderstanding**. Passing tests then prove nothing — only that the two agree with each other.

---

## 2. The core loop

```text
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐
   │ Decide  │───▶│ Generate│───▶│ Verify  │───▶│ Ship & watch │
   │ bound   │    │  (AI)   │    │ evidence│    │ push to main │
   │ oracle  │    │         │    │ → truth │    │ CI same four │
   └─────────┘    └─────────┘    └────┬────┘    └──────┬───────┘
        ▲                             │                │
        │   ambiguous req / broken    │                │ prod issue
        │   assumption                │                ▼
        │◀────────────────────────────┘        ┌──────────────┐
        │                                     │  Escalate    │
        └─────────────────────────────────────│ ADR/test/lint│
              new constraints gate the next   └──────────────┘
              decision
```

Every stage of the loop has an owner in this repo:

| Stage        | Form in this repo                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Decide       | boundaries and red lines in [AGENTS.md](../AGENTS.md), `docs/features/` contracts, `docs/decisions/` ADRs, the scope written into the task |
| Generate     | the agent working in the repo, producing a diff                                                                                            |
| Verify       | `pnpm run check` — the four checks, incl. `test/boundaries.test.ts` and the root HTTP integration tests                                    |
| Ship & watch | direct push to `main` (user-approved each time) + CI running the same four; at runtime, pino request logs and the error boundary           |
| Escalate     | ADRs, boundary tests, lint rules, kernel red lines                                                                                         |

Three feedback edges matter:

1. **Verify → decide**: when verification reveals ambiguity or a broken assumption, **go back to decision** — don't let the AI guess its way through. AGENTS.md hard-codes one case: when code and docs disagree and the conflict touches data / security / public interfaces, stop and ask the user; don't pick a side.
2. **Watch → escalate**: production issues and test-found issues go through the same escalation flow.
3. **Escalate → decide**: new constraints gate future changes; old ones retire per §6.4.

---

## 3. Decide: draw the boundary before generating

The output of the decision stage is a **scope statement** for the task, written into the task itself. A solo repo doesn't need change-card coordination overhead, but the scope statement carries the same duties: instructions to the AI, and the baseline the diff is checked against at verification.

### 3.1 Single intent

**One change does one thing.** Refactors land separately from behavior changes; dependency upgrades separately from features. The repo's commit convention is this discipline in minimal form: a single-subject Conventional Commit — if a second intent doesn't fit on the subject line, split the change.

The reason: decision, verification, and rollback costs all grow superlinearly with diff size. Mixed-intent changes:

- leave the reviewer unable to tell deliberate from incidental edits;
- cannot be partially reverted;
- make test failures unattributable to an intent.

Rule of thumb: past ~400 changed lines (excluding generated files and snapshots), or past one module boundary, consider splitting.

### 3.2 State the boundary explicitly

Tell the AI three things:

- **What may change**: the files, modules, functions in scope;
- **What may not change** — this repo keeps a default list; unless the task names them, none of these move:
  - `data/`: production data, not one byte by default;
  - `docs/features/` contracts and `docs/decisions/` ADRs: changing a contract must itself be the task's intent, and both language mirrors change together;
  - the closed error-code union in `apps/server/src/domains/<domain>/errors.ts`: new codes are added in the domain and mirrored into both web clients;
  - the `PLAN.md` version matrix (single source of truth for the pnpm catalog) and the lockfile;
  - CI configuration and `test/boundaries.test.ts`;
- **What to do when unsure**: stop and ask; never assume.

### 3.3 Define the acceptance evidence (oracle)

**Answer before generating: what observation would convince me this is right?**

Sources of truth, weakest to strongest, each with its form in this repo:

| Source                                                          | Independence | Form in this repo                                                                                    |
| --------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| AI's own "done, no issues"                                      | None         | **Not evidence**                                                                                     |
| Tests written by the AI in the same context                     | Weak         | Likely shares the same misunderstanding                                                              |
| Tests written in an **isolated context** from the spec          | Medium       | another session or another model, reading only the `docs/features/` contract, not the implementation |
| Existing domain tests + root HTTP integration tests             | Strong       | fake AI, temp data directories — independent of production by construction                           |
| Type contracts, zod schemas, closed error-code unions           | Strong       | machine-enforced by `pnpm run typecheck` and kernel validation                                       |
| A human walk-through in dev; explicitly authorized real-AI runs | Very strong  | directly against the real world; reported separately from local automation                           |

Requirement: **every change carries at least one piece of "strong" or better evidence** — or an explicit note on why that isn't possible.

### 3.4 Risk tiers

The tier sets the verification intensity, so not everything runs at maximum ceremony. The repo's tiers align with AGENTS.md's "what you changed is what you run" matrix:

| Tier   | Typical in this repo                                                                                          | Minimum verification                                                     | Human gate                        |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| **R0** | Docs, comments                                                                                                | link & stale-path check + `git diff --check`                             | read it once                      |
| **R1** | features and fixes inside one domain                                                                          | the matrix row's commands + `pnpm run lint` + `format:check`             | review the diff                   |
| **R2** | composition-root wiring, `packages/contract`, wire error codes, schema / storage formats, dependency upgrades | full `pnpm run check` + bilingual contract sync; an ADR if architectural | review design + diff              |
| **R3** | `data/` maintenance, real AI calls, remote deploys                                                            | R2 + **SHA-256** checksums before and after + rollback rehearsal         | **user-authorized, step by step** |

A solo repo has no "second reviewer"; the R3 equivalent is the user performing the step personally, or supervising and approving each move.

### 3.5 Design the rollback before writing code

Answer beforehand: **how do I get back to the last known-good state, and how long does it take?**

- **Code**: single-intent commits on `main` revert cleanly; check the commit hasn't been built upon first;
- **Data**: back up before `data/` maintenance and compare checksums; product data takes care of itself — the immediate tier carries a revert window (10 minutes by default), the gated tier writes zero bytes before confirmation;
- **External side effects**: this repo has essentially none (self-hosted, loopback, Docker binds `127.0.0.1:8629` only); real AI calls spend real money and don't roll back — hence the authorization requirement.

> If the rollback plan is "figure it out then", the change is at least R2.

---

## 4. Verify: approach truth with evidence after generating

### 4.1 The evidence ladder

```text
weak ───────────────────────────────────────────────────────────▶ strong
AI claim → human reads diff → pnpm run test → pnpm run check → CI same four → production
```

**"The AI says it's fine" and "the code looks right" are not evidence.** AI-generated errors are precisely the ones that look right. The last rung — pino request-lifecycle logs, the error boundary's stack-only 500 report, write receipts — is production as the final verifier.

### 4.2 Independence

Guarding against "tests share the implementation's misunderstanding" and "the agent edits tests to make them pass":

- **Critical tests are read-only**: `test/boundaries.test.ts` and the root integration tests are read-only as far as the agent is concerned — editing them to "make tests pass" is redrawing the ruler to fit yourself;
- **Review test diffs separately**: any deleted test, weakened assertion, or added `skip` needs a stated reason;
- **Tests isolated from production**: this repo's tests use temp data directories and fake AI, never touching production data — a security red line that doubles as evidence independence;
- **Contract first**: the acceptance criteria in `docs/features/` exist before the implementation. Behavior changes update the contract (and its mirror) first; tests answer to the contract, not to the implementation.

### 4.3 Review the diff against intent

Check the diff item by item against the scope statement:

- Files touched outside the declared scope?
- "Drive-by" refactors, renames, reformatting?
- New dependencies? They go into the pnpm catalog (versions per the `PLAN.md` matrix); verify the package actually exists — watch for AI-invented package names getting squatted (slopsquatting); major upgrades land as their own commit;
- Deleted code that looked "unused"? That may have been an edge-case handler.

### 4.4 High-frequency AI failure modes

| Class               | Typical symptoms                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary conditions | empty collections, null, zero, max values, timezones, Unicode; **repo-specific**: explicit `false` and numeric `0` are valid data, never "missing" |
| Error paths         | swallowed exceptions, happy-path-only, unbounded retries                                                                                           |
| Concurrency         | races, non-atomic check-then-act, shared mutable state                                                                                             |
| Resources           | unclosed connections/files, unbounded caches, N+1 queries                                                                                          |
| Security            | concatenated SQL/shell, hardcoded secrets, over-broad permissions, unvalidated input                                                               |
| Hallucination       | calling nonexistent APIs or parameters, outdated library idioms                                                                                    |
| Silent degradation  | papering over errors with defaults, empty catch blocks that make tests "pass"                                                                      |

### 4.5 When to go back to decision

Any of these: **stop generating, return to decision**:

- the requirement admits two reasonable readings;
- the implementation needs something on the "may not change" list;
- the same failure survives 2–3 repair rounds — the problem definition is probably wrong;
- the diff is far beyond what was expected.

> Letting an AI iterate on an ambiguous requirement is the most expensive way to work.

---

## 5. Ship and watch: production is the final verification

Tests cover only the cases you **thought of**. A solo self-hosted repo has no canary, feature-flag, or shadow-traffic infrastructure — but the principle doesn't lapse; it takes a different shape here.

### 5.1 Shipping code

- **Precondition**: `pnpm run check` green locally — a hard AGENTS.md requirement;
- **Gate**: every commit and every push needs the user's explicit approval — the release decision always belongs to the human; the agent never auto-commits;
- **Safety net**: CI runs the same four checks after every push;
- **Rollback**: revert the single-intent commit. Write down beforehand what triggers a straight revert — judging "is this blip a problem" after the fact is easily captured by sunk costs.

### 5.2 The product's writes are progressive delivery, runtime edition

Toby ships this section as a runtime ([decisions/write-confirmation-tiers.md](decisions/write-confirmation-tiers.md), [decisions/actions-kernel.md](decisions/actions-kernel.md)):

- **Immediate tier** = execute now + revert window: additive changes land at once, revertible for minutes — the user-scale equivalent of canary and rollback;
- **Gated tier** = proposal → confirmation: destructive changes wait for a human yes; zero writes before confirmation, cancel leaves zero side effects;
- **Actions kernel** = the single write path, single-flight, transactional — atomicity and auditability of release.

### 5.3 Traceable changes

- Single-subject Conventional Commits: every deployment maps to one intent;
- pino request-lifecycle logs + the error boundary's stack-only 500 report ([decisions/server-logging.md](decisions/server-logging.md));
- Write receipts carry before/after snapshots — every product-data write has an audit record;
- When something breaks, "what changed recently" is answerable in minutes.

---

## 6. Escalate: lock the lesson into structure after the stumble

### 6.1 The hardness ladder (with this repo's instances)

| Level  | Form                                                             | Instances in this repo                                                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L0** | memory, verbal agreement                                         | — (nothing should stop at this level)                                                                                                                                                                                                                  |
| **L1** | documents                                                        | [AGENTS.md](../AGENTS.md), `docs/features/` contracts, README                                                                                                                                                                                          |
| **L2** | reviewer attention                                               | a solo repo's review = reading your own diff line by line; fails when tired                                                                                                                                                                            |
| **L3** | lint, static analysis, CI                                        | ESLint, Prettier, the CI four; `tsc`'s `erasableSyntaxOnly` makes enums / namespaces / constructor-parameter properties **unwritable**                                                                                                                 |
| **L4** | tests, regression tests above all                                | `test/boundaries.test.ts` (domain isolation, dependency direction, `types.ts` purity), domain tests, root HTTP integration, fake-AI tests                                                                                                              |
| **L5** | types, interface design, architectural isolation, runtime guards | the actions kernel as single write path (bypass = defect); session guard on by default with explicit opt-out; closed error-code unions in `errors.ts`; AI tool safety-kind gating — prohibited capabilities **don't exist as tool definitions at all** |

**Escalation means pushing a class of error down this table.** A lesson that only made it into a document is not blocked by anything.

Escalations that actually happened here:

| Error / risk                           | The old, soft constraint                   | The current, hard one                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domains importing each other           | prose rules in vertical-domains.md (L1)    | `test/boundaries.test.ts`: a new domain is governed the moment it lands, discovered from the filesystem (L4)                                                                          |
| Unreliable AI output format            | JSON protocol described in the prompt (L1) | tool calls + schema boundary validation + per-domain deterministic validation — the three-layer ladder (L5, [decisions/ai-output-constraints.md](decisions/ai-output-constraints.md)) |
| Write endpoints bypassing confirmation | a documented red line (L1)                 | every write goes through the kernel, transactional and single-flight; bypass is a defect (L5)                                                                                         |
| New route missing auth                 | checklist-style reminder (L2)              | composition root mounts the session guard on every `/api` route by default; public requires explicit `config: { public: true }` (L5)                                                  |

### 6.2 The escalation flow

Every confirmed error answers two questions:

1. **Why was it writable?** → a decision- or structure-level constraint (toward L5);
2. **Why wasn't it caught earlier?** → a verification-level constraint (toward L3–L4).

Then:

- land it at **the hardest feasible level**;
- **add at least one regression test**, with the origin noted in it;
- architecture-level constraints → a new ADR: the why, the decision, the relationship to existing ADRs;
- sync the L1 layer (AGENTS.md / contract docs). That layer is a supplement — **never the only one**.

### 6.3 Registration: the ADRs are the registry

Everything a constraint registry would hold — origin, content, protected asset, retirement — is carried by `docs/decisions/`: the filename is the ID, the Why section the origin, the Relationship section the links and coverage, supersession the retirement. No separate registry is kept.

### 6.4 Retiring constraints

Constraints that only accumulate rigidify the system: CI slows, rules conflict, false positives train people to bypass, nobody remembers why a rule exists.

A solo repo doesn't run quarterly reviews; retirement review is **triggered** — when a constraint trips you up, when a harder one covers it, when the module it protects is deleted or rewritten. Forms of retirement:

- an ADR marked superseded (precedent: ai-output-constraints superseded the retired ai-integration's prompt protocol);
- deleting a lint rule, deleting an exception row in the boundary tests;
- distinguishing "consistently intercepting" from "risk gone" in a zero-trigger constraint — the former should stay.

> Retiring a constraint is itself a change, and goes through decide → verify → revertible like any other.

---

## 7. Change granularity and revertible design

### 7.1 Expand–Contract

Every change touching interfaces, schemas, or data formats splits into independently shippable steps:

```text
1. Expand  : add the new field/interface, old ones untouched    ← revertible anytime
2. Migrate : dual-write, move reads over gradually              ← revertible anytime
3. Verify  : watch until the new path is stable
4. Contract: remove the old field/interface                     ← the only irreversible step;
                                                                 its own commit, its own approval
```

The product's write tiers are this pattern at the data layer, runtime edition: additive goes immediate (a revertible expand), destructive goes gated (a separately approved contract). Code does the same: add the new path so it coexists with the old, stabilize, then remove the old in its own commit.

### 7.2 The irreversible-operations list

These default to **R3**; the AI never executes them autonomously; a human approves:

- touching `data/`: maintenance requires the user to name it, with SHA-256 comparison before and after;
- real AI calls, remote deploys, writing production data — the three red lines of automated testing; running any requires explicit authorization in the task, with results reported separately;
- force pushes, rewriting `main`'s history;
- shipping a breaking change without the expand step.

### 7.3 The agent's execution environment: product and development share one answer

The constraints this repo places on the product's AI mirror the ones placed on the coding agent:

| Constraint for whom     | Product side: Toby's AI assistant                                         | Development side: the coding agent in this repo          |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Capability boundary     | tools carry a safety kind (read-only / write-intent), policy-gated        | permission modes gate tool calls; AGENTS.md prohibitions |
| Prohibited capabilities | database, shell, file paths **absent as tool definitions**                | no auto commit / push; never touch `data/`               |
| Form of writing         | write-intent tools only draft writes; effects still go through the kernel | code edits only produce diffs, reviewed by the human     |
| Final say               | the AI never confirms and never reverts on the user's behalf              | every commit and push needs the user's approval          |

---

## 8. Division of labor between human and AI

| Stage    | Human (maintainer) owns                                             | AI is good at                                                                                                      |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Decide   | intent, boundaries, risk tier, **defining the acceptance evidence** | clarifying questions, enumerating edge cases, drafting the scope statement                                         |
| Generate | reviewing direction drift                                           | implementations, boilerplate, mechanical migration                                                                 |
| Verify   | judging whether evidence suffices; approving R2/R3                  | running the checks with real output attached, adversarial tests in an **isolated context**, first-pass diff review |
| Ship     | approving each commit / push; rollback decisions                    | summarizing check results, diffing change summary against scope                                                    |
| Escalate | choosing the level, deciding retirement                             | drafting lint rules, regression tests, ADR drafts                                                                  |

**Principle: the AI may propose anything, but "what counts as right" and irreversible decisions belong to the human.** The product mirrors this principle as write-confirmation-tiers' red line: the AI never confirms and never reverts on the user's behalf.

---

## 9. Anti-patterns

| Anti-pattern                                                       | Problem                                                 | The right form in this repo                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "The AI says tests pass"                                           | nothing was run, or the tests were edited               | attach real `pnpm run test` output                                                                   |
| AI writes implementation and tests together; green tests settle it | both share one misunderstanding                         | contract first (features docs); tests isolated via fake AI and temp directories                      |
| One commit = feature + refactor + dependency bump                  | unreviewable, unrevertible in part                      | single intent; single-subject Conventional Commits                                                   |
| Test fails → "fix until green"                                     | the AI may weaken assertions or edit the boundary tests | first decide whether the implementation or the test is wrong; `test/boundaries.test.ts` is read-only |
| After a stumble, only AGENTS.md gets updated                       | L1 constraints quietly lapse                            | push to L3–L5 (live precedent here: prose architecture rules became boundary tests)                  |
| Constraints only accumulate                                        | rigidity; rules routinely bypassed                      | ADR supersession, lint cleanup, triggered review                                                     |
| Unclear requirement → "have the AI build a version first"          | the ambiguity hardens into code                         | return to decision; stop and ask when code and docs conflict                                         |
| Rollback "figured out later"                                       | improvising under incident pressure                     | checksum comparison for `data/` maintenance; write the revert path before shipping                   |

---

## 10. Measurement: is the practice itself working

A solo repo keeps no dashboard; four signals suffice:

| Signal                                      | Measures                                  | Desired trend                |
| ------------------------------------------- | ----------------------------------------- | ---------------------------- |
| **Recurrence rate of the same error class** | whether escalation works                  | → 0                          |
| Where errors are caught                     | decision / verification / CI / production | shift left                   |
| Average diff size                           | granularity discipline                    | steady, within single intent |
| `check` duration                            | the cost of constraints                   | bounded, not creeping up     |

> Don't measure "how much code the AI generated." Generation volume is a cost line, not an output line.

---

## 11. One-sentence summary

> **Every change small enough to verify, independent enough to falsify, ready to revert. Every confirmed error pushed to the level that makes it harder to recur; every constraint that no longer earns its keep, removed.**

---

## Appendices

<details>
<summary><b>Appendix A: per-change checklist</b></summary>

```text
[Decide] before generating
  □ Single intent? Scope written into the task?
  □ Risk tier set (R0–R3)?
  □ "May not change" list told to the AI (data/, contracts & ADRs, errors.ts,
    PLAN.md matrix, CI & boundary tests)?
  □ Acceptance evidence defined, at least one item "strong" or better?
  □ Rollback path and cost known? Irreversible parts identified?

[Verify] after generating
  □ Ran the matrix row's commands, real output attached?
  □ Any tests deleted, skipped, or with weakened assertions?
  □ Diff outside the scope statement? New deps in the catalog, package real?
  □ Boundaries (incl. explicit false / 0), error paths, concurrency,
    resources, security checked?
  □ Any signal that says: return to decision?

[Ship] R2 and above
  □ pnpm run check fully green locally?
  □ User approved the commit / push, one by one?
  □ Revert path (which commit to revert) explicit?

[Escalate] after a stumble
  □ Answered "why was it writable" and "why not caught earlier"?
  □ Landed at the hardest feasible level? Regression test added with origin noted?
  □ Architecture-level ones written up as ADRs? AGENTS.md L1 synced (and not the only layer)?
  □ Checked for old constraints ready to retire?
```

</details>

<details>
<summary><b>Appendix B: post-mortem mini-template (for escalation)</b></summary>

```markdown
## Post-mortem: <one-line description>

**Caught at**: decision / verification / CI / production
**Impact**:

### 1. Why was it writable?

(missing type constraint, interface design, architectural isolation, kernel red line?)

### 2. Why wasn't it caught earlier?

(missing test, check, logging? was the evidence independent?)

### 3. Escalation landing

| Measure | Level (L1–L5) | Landing (regression test / lint / ADR / kernel) |
| ------- | ------------- | ----------------------------------------------- |

### 4. Constraints ready to retire

(did this one cover or invalidate an older constraint?)
```

Architecture-level post-mortems land directly as new ADRs in `docs/decisions/` (with Why and Relationship sections); local lessons land as regression tests with the origin noted. Both count as registration — no separate ledger.

</details>

---

**Note**: the generic playbook's "start with three things" is already in place here — AGENTS.md (L1 red lines), `test/boundaries.test.ts` (L4), the actions kernel (L5). New lessons follow §6.2: ask the two questions, land at the hardest feasible level, register via ADR. Escalation itself stays evidence-driven.
