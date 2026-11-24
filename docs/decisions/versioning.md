# Versioning

English | [简体中文](versioning.zh.md)

> **Source**: [Epoch Semantic Versioning](https://antfu.me/posts/epoch-semver),
> Anthony Fu, 2025-01-07.

## The scheme

`{EPOCH × 1000 + MAJOR}.MINOR.PATCH` — the first number carries two
meanings:

- **EPOCH** (the thousands): a ground-up rewrite — a `v1000.0.0`-style
  jump with a code name. Rare.
- **MAJOR**: technical breaking changes that need not alarm anyone —
  breaking changes are not marketing events.
- **MINOR**: features. **PATCH**: fixes.

Zero-epoch reads as plain SemVer, so nothing changes mechanically.
