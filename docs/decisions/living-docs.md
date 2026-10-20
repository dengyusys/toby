# Documentation Maintenance Rules

English | [简体中文](living-docs.zh.md)

Docs maintain only two kinds of content: **behavior contracts** and **design decisions**.

- `features/`: each domain's responsibilities, behavior agreements, and security boundaries.
- `decisions/`: the reasoning behind architecture and technology choices, and the trade-offs considered when making them.
- `system-overview.md`: the architecture map, updated when the architecture changes.
- `README.md`: the documentation index.

Implementation detail belongs to the code; development progress belongs to the Git commit history; acceptance criteria belong to the test suite — none of them are duplicated in docs.

## Maintenance rules

- When a behavior contract changes, update the matching `features/` doc.
- New design decisions get their own record; existing decision history is never overwritten.
- Superseded decisions are marked `Superseded`.
- Once a design discussion is finalized, fold the conclusions into the matching doc and delete the scratch draft.

The goal of documentation is to make trustworthy information quick to find — not to record the development process in full.
