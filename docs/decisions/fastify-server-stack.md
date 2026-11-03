# Why plain Fastify

English | [简体中文](fastify-server-stack.zh.md)

What the server actually needs is small: a handful of JSON routes, one error
body, a session check, a request body limit and two static mounts. A
framework's container, module graph and decorator pipeline cost more than
they returned at that size — decorator metadata compiled into every build
(and an swc transform to reproduce it under test), the server as the one
package exempt from the repository's erasable-syntax rule, and a test harness
that rebuilt the module graph before any request could run.

Fastify hands over exactly the load-bearing parts as plain, documented,
standard pieces: routing that matches on the decoded path (so an encoded
variant still lands on the route and its guard), the body limit, lifecycle
hooks, one error handler and one not-found handler, plugin encapsulation, and
`inject` to drive the full request lifecycle in tests without a socket.
Everything else is plain TypeScript: services are closure factories over
explicit dependencies, and composition is ordinary function calls. No
decorators, no container, no reflection — the server follows the same
erasable-syntax rules as every other package and compiles with plain `tsc`.

## In this repository

- `src/app.ts` is the composition root: the HTTP shell (body limit, error
  boundary, not-found answer, `no-store`, cookies, the SPA mounts) and the
  domain order. `src/main.ts` only resolves config, listens, and closes on
  signals.
- Each domain keeps three role files: `<domain>.routes.ts` (the HTTP shell, a
  Fastify plugin), `<domain>.service.ts` / `store.ts` (closure factories with
  no HTTP imports), and `<domain>.plugin.ts` (assembly, plus lifecycle through
  `onClose`).
- The session guard is an async `preHandler` the composition root installs
  on every `/api` route by default; a route opts out with
  `config: { public: true }` (health, the auth endpoints). Static pages
  never carry it — the login page must load without a session.
- One error body: a `DomainHttpError` passes through as built, a framework
  4xx gets a status-derived code, anything else is the sanitized 500.

This replaces the NestJS decision (NestJS 12 on the Node HTTP adapter). The
wire contract did not change — the root HTTP integration test pinned it
through the switch, and a request-by-request differential run against the
old server confirmed it; what went away is the container, the decorators and
their toolchain (`@nestjs/*`, `reflect-metadata`, `rxjs`, the swc test
transform, `supertest`). A few byte-level details differ with no semantic
effect: error message texts, Set-Cookie attribute order, the empty `/m`
redirect body, the `/m/..` redirect answer, the `.js` content type, the
416's advisory headers, and malformed-HTTP client-error bodies.
