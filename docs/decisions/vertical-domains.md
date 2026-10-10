# Why We Organize Code by Business Domain

English | [简体中文](vertical-domains.zh.md)

## The core idea

This repository organizes code by business domain instead of the traditional technical layering.

The reason is simple: **I want the code structure to reflect the business itself, not just the technical responsibilities of the code.**

The tech stack is stable; future development revolves around business features like schedules and bookkeeping. Compared to splitting directories into Controller / Service / Repository, keeping all code of one business domain together fits the way this project evolves.

## How is this different from technical layering?

Traditional layering organizes directories by technical responsibility:

```text
src/
├── controllers/
├── services/
├── repositories/
└── models/
```

This is clean and works well for managing HTTP entry points, business services, and data access uniformly. But as business domains grow, the code of one business scatters across multiple directories.

Organizing by business domain keeps related code together:

```text
src/
├── domains/
│   ├── schedule/
│   │   ├── router.ts
│   │   ├── service.ts
│   │   ├── store.ts
│   │   └── types.ts
│   └── ledger/
│       ├── router.ts
│       ├── service.ts
│       ├── store.ts
│       └── types.ts
├── infrastructure/
└── main.ts
```

Both approaches can keep a clear division of responsibilities. The difference: traditional layering groups code with the same technical role; domain slices group the different technical roles of the same business.

For example, when modifying the ledger feature, the routes, business logic, and storage all sit in `domains/ledger/` — no hunting through multiple technical directories.

## Why domain slices?

**First, the code structure tracks business change.**

When a feature is added, its code stays inside the matching domain. Adding a new domain means adding a module and wiring it in `main.ts`, leaving existing modules untouched.

**Second, business boundaries become explicit.**

Each domain owns its rules, logic, and data access, and does not import other domains. Cross-domain collaboration is wired in `main.ts` through explicit interfaces.

With static checks like ESLint, these constraints are enforced by tooling — not left to developer discipline.

**Third, business logic is easier to understand and test.**

A domain's implementation lives in one directory; you don't need to understand the whole project's layering to read it.

Business rules that avoid framework and infrastructure dependencies can be plain functions — unit-testable directly, without an HTTP server or a database.

## Why not microservices?

This project needs business boundaries, not independent deployment.

Slicing into modules gives good isolation and independent evolution while keeping single-process deployment simple. There is no reason to pay microservice costs in communication, deployment, and debugging just to get boundaries.

So this repository is a modular monolith: modules stay isolated in code, assembled and run by one process.

## Implementation constraints in this repository

- Each domain owns its routes, business logic, storage, and rules.
- Domains never import each other; `main.ts` does module assembly and cross-domain wiring.
- `infrastructure/` provides generic technical capabilities and never depends on a business domain.
- ESLint checks module dependencies so the boundaries cannot be broken by accident.
- Pure business rules avoid framework dependencies, so they stay independently testable.

The goal of this design is not a fancier architecture — it is keeping the code organized the way the business evolves.
