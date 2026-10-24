# Why We Organize Code by Business Domain

English | [简体中文](vertical-domains.zh.md)

## The core idea

This repository organizes code by business domain instead of the traditional technical layering.

The reason is simple: **I want the code structure to reflect the business itself, not just the technical responsibilities of the code.**

The tech stack is stable; future development revolves around business features like schedules and bookkeeping. Compared to splitting directories into Controller / Service / Repository, keeping all code of one business domain together fits the way this project evolves.

## How is this different from technical layering?

Traditional layering organizes directories by technical responsibility (`controllers/`, `services/`, `repositories/`, `models/`): clean for managing each technical role uniformly, but the code of one business scatters across directories as domains grow. Domain slices group the different technical roles of the same business:

```text
src/
├── domains/
│   ├── schedule/
│   │   ├── controller.ts
│   │   ├── service.ts
│   │   ├── store.ts
│   │   └── types.ts
│   └── ledger/
│       └── …same shape…
├── infrastructure/
└── main.ts
```

For example, when modifying the ledger feature, the routes, business logic, and storage all sit in `domains/ledger/` — no hunting through multiple technical directories.

## Why domain slices?

**The code structure tracks business change.** Adding a new domain means adding a module and wiring it in `main.ts`, leaving existing modules untouched; each domain owns its rules, logic, and data access and does not import other domains — cross-domain collaboration is wired in `main.ts` through explicit interfaces, and ESLint enforces these constraints so they are not left to discipline.

**Business logic is easier to understand and test.** A domain's implementation lives in one directory; you don't need to understand the whole project's layering to read it. Business rules that avoid framework and infrastructure dependencies can be plain functions — unit-testable directly, without an HTTP server or a database.

## In this repository

The concrete boundaries (never import across domains, infrastructure never depends on domains, machine-enforced by ESLint) are owned by the [system overview](../system-overview.md) and `AGENTS.md` — see those instead of a second list here.

The goal of this design is not a fancier architecture — it is keeping the code organized the way the business evolves.
