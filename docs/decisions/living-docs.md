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
- Every document is iterated in place — a retired document is deleted, not marked. Git history is the archive.
- When a decision replaces an older one, the new record ends with a brief note on what changed — scaled to the significance of the change.
- Once a design discussion is finalized, fold the conclusions into the matching doc and delete the scratch draft.

The goal of documentation is to make trustworthy information quick to find — not to record the development process in full.
