# Why @toby/contract Exists

English | [简体中文](contract-package.zh.md)

## The core idea

Two web apps talk to the same server. **API clients, types, and request logic must be identical in both — so keep exactly one copy.**

`@toby/contract` is that copy: the shared contract package for both apps.

## What problem it solves

Without it, each app maintains its own requests and types:

- An API change must be applied in two places; miss one and the other app breaks at runtime
- The same concept gets two type definitions that drift apart over time
- The contract has no single source of truth

In one package, a contract change is made once and both apps get it.

## Why it must be pure logic

The package has one hard rule: **zero JSX, zero CSS, zero DOM.**

- It answers only "how to talk to the server": API clients, types, request wrappers, proposal flows, pure functions
- Interfaces belong to each app (see the dual-app split): components and styles are presentation, and presentation forks by design
- The rule keeps the package from becoming a junk drawer — stuff everything in, and the two apps get chained back together, making the split pointless

## How it is consumed

- A workspace package, depended on by both apps in the `apps → packages` direction
- Deep paths + `.ts` — source is consumed directly, no build, no publishing
- Server-side types used by the apps are defined here, once

## Implementation constraints in this repository

- Cross-app sharing goes only through `@toby/contract`, which stays zero-component and zero-style forever
- Dependency direction is always `apps → packages`; packages never import apps; apps never import each other
- Contract changes are made in this package only, taking effect in both apps at once
