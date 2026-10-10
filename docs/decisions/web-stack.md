# Why the Web Runs This Stack

English | [简体中文](web-stack.zh.md)

## The core idea

One criterion: **mainstream ecosystem, minimal config — and every choice must survive being copied into two apps.**

## React + Vite

- **React 19**: the largest ecosystem; whatever you need exists
- **Vite 6**: fast dev, minimal config; two apps with nearly identical configs are cheap to maintain

No Next-style full-stack framework: the server is already Fastify, and the frontend only needs pure static output.

## Tailwind v4 + shadcn

- **Tailwind v4**: the theme is one CSS variable file; components consume semantic tokens only, never raw color values
- **shadcn**: component source lives in the repo, not an npm dependency — **edit freely, never pinned to an upstream release**

Not MUI / AntD-style component libraries: custom themes fight the library's system, and the bundles are heavy.

## State and routing

- **TanStack Query**: caching, invalidation, and retrying for server state; after a proposal commits, one `invalidateQueries` and every view refetches
- **react-router** (HashRouter): static serving needs no SPA fallback

## Testing

vitest + happy-dom + Testing Library: vitest shares Vite's resolver, near-zero config; happy-dom is light and fast; tests are written from user behavior, not implementation detail.

## Conventions in this repository

- Both apps run the identical stack — React 19 + Vite 6 + Tailwind v4 + shadcn; they differ only in form
- Build output is pure static SPA, served by the single server process
- Shared logic goes only into `@toby/contract`; components and styles are never shared
