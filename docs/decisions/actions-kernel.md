# The Actions Kernel: Tacit-Approval Confirm Gate

English | [简体中文](actions-kernel.zh.md)

Every write-intent AI action in this repository passes through one shared
state machine: the **actions kernel** in `infrastructure/actions/`. The
ledger's proposal registry is its first consumer adapter; chat, schedule,
and every later domain reuse it instead of growing their own.

## Why tacit approval

The product flow is conversational: the user says a sentence, the AI
answers with a proposal card. In that flow, pressing "cancel" means no —
and **silence within the window means go**. Demanding an explicit confirm
for every write would turn the conversation back into a form-filling
session; the window keeps the flow while keeping the pen in the user's
hand, because one "cancel" — before the deadline — stops everything.

## The semantics (load-bearing)

- **30-second tacit-approval window.** A pending proposal auto-executes
  when the window passes. Silence is approval; only an explicit cancel
  stops it. The sweeper ticks every second, so the write lands within
  about a second of the deadline.
- **10-minute TTL backstop.** A proposal whose execution keeps failing
  expires hard; expiry answers 410.
- **Single-flight, idempotent forever.** The sweeper and a manual confirm
  share one execution; after success the stored result is echoed on every
  re-commit — no double writes, ever.
- **Failure leaves it pending.** A failing executor keeps the proposal
  pending; every sweep retries until the TTL expires it. The failure is
  logged, never silent.
- **Restart loses unconfirmed proposals.** The registry is in-memory:
  only committed data persists. This is deliberate — an unconfirmed
  proposal was never agreed upon, so dropping it on restart is the honest
  behavior. Backups therefore only ever contain committed data.
- **Wire contract.** The `PROPOSAL_*` error codes (404/409/410) are what
  the web clients match on; renaming to `ACTION_*` is a cross-client
  change deferred until the second domain adopts the kernel.
- **Retention.** Expired records are pruned an hour after expiry; after
  that a commit is a plain 404.

## Guardrails

- The kernel starts no timers: domains drive the sweeper from their
  module and pass their executors at commit time.
- Executors never run outside the gate: every write-intent AI tool
  routes through a proposal; direct-write endpoints are defects.
- Prohibited capabilities (database, shell, file paths) never become
  tools at all.

## The numbers

30-second tacit window (chat-flow latency budget), 10-minute TTL (ten
windows of grace for a failing store), 1-hour retention (memory bound),
1-second sweep tick (write lands within about a second of the deadline).
All four are defaults, overridable per domain.

## Reference

Formalized 2026-10-24: the rules above lived in code comments and the
ledger implementation until this record. Related documents: the backup
procedure ([docs/operations/backup.md](../operations/backup.md)) draws
its restart boundary from the in-memory semantics above; the tool-kind
gate is defined in [ai-pi-runtime.md](ai-pi-runtime.md).
