# Tiered Writes: Immediate for Additive, Confirmed for Destructive

English | [简体中文](write-confirmation-tiers.zh.md)

## Why

- Lived use says so: the 30-second tacit window already made auto-write the de facto
  default, so for additive writes the pre-write step costs latency and a click without
  adding veto value. The product's philosophy is tested by use, and use has spoken.
- Write risk is not uniform. Appending a ledger entry and rewriting an
  owner-maintained note are different risk classes; one gate for both overcharges the
  safe class and underexplains the dangerous one.

## The model

Writes divide into two tiers. Assignment is **per operation**, recorded in each
domain's feature doc; the default rule: append-only operations are **immediate**,
operations that overwrite, remove, or redefine are **gated**.

- **Immediate tier** — execute transactionally at once. The proposal card is **born
  confirmed** (no pending state) with the same before/after snapshot plus a
  `revertUntil` timestamp; in the chat stream it is the write's receipt. No 30-second
  wait, no confirm click.
- **Gated tier** — unchanged: pending, 30-second tacit auto-write, explicit confirm,
  cancel as the only refusal, 10-minute TTL.

The actions kernel remains the single write path for both tiers — single-flight,
transactional, journalled. The tiers differ only in ordering: immediate is
execute-then-journal, gated is journal-then-execute. A write endpoint bypassing the
kernel is still a defect.

## Revert window

- While `now < revertUntil` (default 10 minutes — the same magnitude as the gated
  TTL), the user may revert a born-confirmed card; revert applies the before-snapshot
  in one transaction.
- Revert is user-clicked; the click is the confirmation — no second gate.
- If a later write has touched the same record, revert refuses with the existing
  conflict semantics: the newer write wins.
- This is deliberately **not** general undo: no history browsing, no multi-step
  rewind. After the window the card is a plain receipt.

## What stays red lines

1. Every write goes through the actions kernel, transactional and single-flight. The
   kernel-centric sentence replaces the confirmation-centric one in AGENTS.md,
   README, and the system overview.
2. Prohibited capabilities remain absent; the AI never confirms and never reverts on
   the user's behalf.
3. Destructive operations keep their pre-write gate (notes rewrite / remove / merge,
   memory remove, tracker create / amend / archive).
4. The trust boundary is unchanged: deterministic server-side validation before any
   write, either tier.

## Tier assignment so far

| Domain        | Immediate                                            | Gated                            |
| ------------- | ---------------------------------------------------- | -------------------------------- |
| ledger        | entry append (batch, 1–10)                           | —                                |
| schedule      | field writes                                         | tracker create / amend / archive |
| notes         | monthly add / append, topic new / append             | rewrite / remove / merge         |
| memory        | upsert                                               | remove                           |
| todo, library | assigned when the domain lands, default rule applies | —                                |

Proactive turns (when trigger-sourced inputs arrive): immediate-tier writes proceed
unattended — low risk by construction; gated-tier proposals never auto-write before
the user has seen them.

## Relationship and rollout

Amends red line 2 of [ai-pi-runtime.md](ai-pi-runtime.md) (confirmation becomes
tiered); [actions-kernel.md](actions-kernel.md) keeps its mechanics and gains the
execute-then-journal path. README, AGENTS.md, the system overview, and the domain
feature docs are rewritten in the same change wave. Ledger pilots the immediate tier
first — it is the domain in daily use; the other domains adopt per landing.
