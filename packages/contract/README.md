# @toby/contract

The shared contract package for the two web apps (`apps/web` and
`apps/web-mobile`): the API clients, wire types, and request logic that
must be identical in both — one copy, consumed directly as TypeScript
source.

Why this package exists: [docs/decisions/contract-package.md](../../docs/decisions/contract-package.md)

## What lives here

| Module                   | Mirrors the server's                                         |
| ------------------------ | ------------------------------------------------------------ |
| `src/request-json.ts`    | shared request wrapper and `ApiError` (the wire error shape) |
| `src/system-client.ts`   | `/api/system/*`                                              |
| `src/ledger-client.ts`   | `/api/ledger/*`                                              |
| `src/memory-client.ts`   | `/api/memory/*`                                              |
| `src/schedule-client.ts` | `/api/schedule/*`                                            |
| `src/settings-client.ts` | `/api/settings/*`                                            |
| `src/auth-client.ts`     | `/api/auth/*`                                                |
| `src/chat-client.ts`     | `/api/chat/*`                                                |
| `src/pi-messages.ts`     | the PI runtime message shapes (types only)                   |
| `src/trace-events.ts`    | the trace event shapes (types only)                          |

## Admission test — what never goes in

"Pure logic" alone is not the bar; a client-side constant is pure too.
Every file here must mirror a server-defined surface, and all three of
these must hold:

1. It mirrors something the server defines — a wire shape, an error code,
   an endpoint — or derives directly from one.
2. Copies that differ between the two apps would make an app _incorrect_,
   not merely inconsistent.
3. A server API change can force this file to change.

Any "no" means the code belongs in each app (each app's
`features/<domain>/<domain>-view.ts` is the pattern; the dual-app split
accepts that duplication by design). Typical rejections: client cache
keys, view helpers, format/parse utilities.

## Hard rules

- Zero runtime dependencies; **zero JSX, zero CSS, zero DOM** — no
  `react`, no `window`/`document`; the package typechecks without the DOM
  lib.
- Pure TypeScript source, consumed directly (deep paths + `.ts`); no
  build, no publishing.
- Dependency direction is always `apps → packages`: this package never
  imports app or server code.
- A change here lands in both apps at once — run `pnpm run check` at the
  repo root before landing.

## Tests

`pnpm --filter @toby/contract run test` — the clients' wire behavior is
pinned in `test/` (auth, ledger, memory, settings, system).
