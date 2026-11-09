# AI Output Constraints: Shape by Schema, Semantics by Code

English | [简体中文](ai-output-constraints.zh.md)

## Why

Generation is sampling, not execution: one request yields a distribution of
outputs. The constraint question is therefore not "make the model behave"
but "make a wrong draft cheap to catch" — and the earlier and more
mechanical the catching layer, the cheaper a wrong draft is. This
repository moved the format constraint twice, each move pulling the catch
point earlier.

## The ladder

- **Prompts carry intent, not formats.** The prompt still exists — preamble,
  rules, per-run context; the `<tools>` section is generated from tool
  metadata, so a rename cannot leave a stale mention (details in
  [ai-pi-runtime.md](ai-pi-runtime.md)). What retired is format-by-prompt:
  the first era described the JSON protocol in the prompt and scraped the
  JSON out of the reply. Compliance was probabilistic, a failure surfaced
  at parse time on the server — after the call was paid for — and the only
  remedy was one blind retry.
- **Tool calls with JSON Schema constrain shape.** Tool calls are the
  model's native structured-output channel; schema-validated arguments are
  machine-checked at the boundary, before any domain code runs. A
  malformed draft bounces back to the model as a tool error and the model
  repairs its own output — correction is a loop bounded by the turn cap,
  not a retry. pi-schema's coercion widens what is accepted but never
  decides admission; a domain never sees data on the strength of coercion
  alone.
- **Deterministic domain validation decides semantics.** A schema can only
  ever check shape; semantics — amounts as integer cents, real calendar
  dates, entry bounds — stay hand-written in each domain (ledger's
  `validation.ts` is the live example). This was the trust boundary on day
  one and never moved.

One line per layer: the prompt is trusted with nothing, the schema with
shape only, the hand-written gate with everything.

## Relationship and history

- [ai-pi-runtime.md](ai-pi-runtime.md) owns the runtime that runs this
  ladder — transport, agent loop, tool kinds, the coercion and
  prompt-assembly details.
- What happens after validation passes — tiered writes, the actions kernel —
  is owned by [write-confirmation-tiers.md](write-confirmation-tiers.md)
  and [actions-kernel.md](actions-kernel.md).
- This record supersedes the format-by-prompt protocol of the retired
  ai-integration.md (restricted JSON, one blind retry). The deterministic
  red line — untrusted AI output, server-side validation before any write —
  carried across both eras unchanged.
