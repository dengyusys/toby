# The Server Runs on NestJS over Fastify

English | [简体中文](nestjs-server-stack.zh.md)

The server is assembled with NestJS 12 on the Fastify adapter. The engine
did not change — Fastify 5 stays — what changed is the organization:
domains are Nest modules with controllers, services are `@Injectable()`
classes with constructor injection (see
[idiomatic-nest-services.md](idiomatic-nest-services.md) for how that
landed), cross-cutting behavior lives in a global exception filter and a
global session guard.

## Why

- **A mature framework's conventions instead of private ones.** Rate
  limiting, validation, OpenAPI and lifecycle hooks come from the
  ecosystem; and the structure is the one every model and collaborator
  already knows (module/controller/provider/guard).
- **Spring Boot transfer.** Modules ≈ configuration scanning, providers ≈
  beans, guards/interceptors/pipes ≈ filters/interceptors/validators —
  learning Nest is learning the Spring skeleton.
- **Deliberate trade-off:** the zero-build, run-the-.ts-directly property
  is given up. `nest build` (tsc) produces `dist/`; `start` and the dev
  watch run from the build output.

## The rest of the stack

The framework-era criterion still governs every choice: **self-hosted,
single-user, single process — everything yields to simple and
controllable.**

- **SQLite via the db adapter port** (see [db-adapter.md](db-adapter.md)):
  one file is one database — no daemon, no credentials, backup is copying
  `data/`; the synchronous driver makes a transaction a plain function
  call, fitting the confirm-then-write model. The single-writer weakness
  does not exist here: one writer, low-frequency transactional writes.
  MySQL exists as a learning adapter behind the same port; domain code
  never sees the difference.
- **typebox** — one schema library, one definition: the ledger draft
  schema is simultaneously the model-facing tool contract and the
  server's shape gate; `typebox/value`'s `Check`/`Errors` validate and
  point at the offending path, and the same error text feeds back to the
  model as a tool error.
- **built-in Nest logger** — the `ConsoleLogger` in JSON mode covers app
  and framework logs (structured params, one machine-readable record per
  line on stdout); services use the documented `new Logger(X.name)`
  facade. HTTP access logs stay Fastify's own (`logger: { level }`,
  pino internally): its default serializers log method/url/host/IP only —
  headers never enter the log, so no redaction is configured (decision:
  deferred; revisit if serializers ever include headers). pino is no
  longer a direct dependency of this app.

## What the migration taught (non-obvious mechanics)

These are load-bearing; changing them breaks tests in confusing ways:

- **`app.init()` before `inject()`.** Controllers are wired onto the
  adapter during `init()` (or `listen()`); the test path never listens, so
  `applyHttpContract` inits explicitly.
- **The root module must be a decorated class.** A plain `DynamicModule`
  object as the NestFactory root instantiates providers but never
  registers routes. Runtime assembly works by applying the `Module`
  decorator imperatively; domain modules may be plain `DynamicModule`
  objects (the standard `forRoot` pattern).
- **Constructor injection everywhere (superseded the property-injection
  rule).** This ADR originally mandated `@Inject(token)` property
  injection because vitest's esbuild transform emitted no
  `emitDecoratorMetadata`. Server tests now run through `unplugin-swc`
  (`apps/server/vitest.config.ts`), which emits decorator metadata like
  the tsc build, and `test/infrastructure/di-metadata.test.ts` pins that
  premise — constructor injection works identically in build and test.
  Value-shaped dependencies still use tokens; see
  [idiomatic-nest-services.md](idiomatic-nest-services.md).
- **`RawErrorFastifyAdapter`.** The stock adapter rewrites `FastifyError`
  into `HttpException`, discarding the `FST_ERR_*` codes the exception
  filter maps onto the public `INVALID_JSON` / `PAYLOAD_TOO_LARGE`
  envelopes; the subclass passes raw errors through.
- **404/405 discrimination lives in the filter.** Nest's default
  not-found handler throws `NotFoundException`; the global filter catches
  it and discriminates 405 (path exists under another method) vs the 404
  envelope, byte-identical to the previous behavior.
- **`abortOnError: false`.** Nest's default `process.abort()` on a DI
  failure eats the error (vitest workers died with SIGABRT); with it off,
  failures surface normally.
- **Fastify is exact-pinned to 5.12.7** — the copy `@nestjs/platform-fastify`
  resolves; any other resolution splits Fastify types and instances in two.

## Deliberate deviations from the migration plan

- **No `@nestjs/serve-static`**: the existing `staticAssetsPlugin`
  (registered on the adapter instance) already serves both SPA roots with
  the exact previous semantics — it IS the plan's fallback option,
  pre-validated.
- **No `nestjs-pino`**: with app logs on the built-in logger there is
  nothing left for it to unify; access logs are Fastify's own at the
  shared `TOBY_LOG_LEVEL`.
- **typebox stays; class-validator removed (resolved).** The deferred
  ValidationPipe adoption was decided against: the ledger draft schema is
  simultaneously the AI tool contract and the server's shape gate, and a
  global pipe would take over body parsing and threaten the `FST_ERR_*`
  envelope mapping. The unused class-validator/class-transformer
  dependencies were dropped — see
  [idiomatic-nest-services.md](idiomatic-nest-services.md).

## Commands

Command semantics live in `AGENTS.md` and `docs/operations/`; one
non-inferable constraint: when Docker lands, the image must use
Node ≥ 22.19 (pi-ai's engines requirement + `engine-strict=true`).

---

## Reference

This decision absorbs the former server-stack.md (retired 2026-10-24,
retrievable from git history); the stack choices above carry over
unchanged.
