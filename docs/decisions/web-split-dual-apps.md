# Why Split the Web into Two Apps

English | [简体中文](web-split-dual-apps.zh.md)

## The core idea

Two reasons, that's all:

**One: evolve independently.** The PC app and the mobile app each grow on their own; changing one never requires thinking about the other. If mobile wants to turn a page into pure conversational input, edit `apps/web-mobile` — the PC app never knows.

**Two: more flexible than responsive.** No need to juggle two form factors with breakpoint classes in one codebase; each app lays out and interacts exactly how it wants.

That's it.

## How the split looks

```text
apps/
├── web/             # PC, entry /
├── web-mobile/      # mobile, entry /m/
packages/
└── contract/        # shared by both: API clients, types, pure logic
```

The only thing that must stay identical across the two apps is the contract with the server — that lives in `@toby/contract`. Interfaces, components, and styles are owned by each app and never shared.

## The trade-off

Component and theme changes are made twice. That is the accepted price for the two ends never constraining each other.

## Implementation constraints in this repository

- The two apps never import each other, enforced by ESLint.
- Sharing goes only through `@toby/contract`, which stays zero-component, zero-style, forever.
- Dependency direction is always `apps → packages`; web apps never import `@toby/server`.
- Same-origin deployment: `/` and `/m/` are served by the single server process, sharing sessions.
