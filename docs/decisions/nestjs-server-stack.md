# The Server Runs on NestJS over Fastify

English | [简体中文](nestjs-server-stack.zh.md)

Status: accepted (supersedes the Fastify/self-assembly framing in
[server-stack.md](server-stack.md)) · Date: 2026-10-23

The server is assembled with NestJS 12 on the Fastify adapter. The engine
did not change — Fastify 5 stays — what changed is the organization:
domains are Nest modules with controllers, services are injected through
tokens, cross-cutting behavior lives in a global exception filter and a
global guard.

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

## What the migration taught (non-obvious mechanics)

These are load-bearing; changing them breaks tests in confusing ways:

- **`app.init()` before `inject()`.** Controllers are wired onto the
  adapter during `init()` (or `listen()`); the test path never listens, so
  `createNestServer` inits explicitly.
- **The root module must be a decorated class.** A plain `DynamicModule`
  object as the NestFactory root instantiates providers but never
  registers routes. Runtime assembly works by applying the `Module`
  decorator imperatively; domain modules may be plain `DynamicModule`
  objects (the standard `forRoot` pattern).
- **Property injection with `@Inject(token)`.** vitest's esbuild transform
  emits no `emitDecoratorMetadata`, so constructor injection is metadata-
  blind under test. Property injection with explicit Symbol tokens works
  under both tsc and esbuild. Tokens live in per-domain `tokens.ts` —
  importing them from the module file creates a circular import that
  silently turns decorators into `@Inject(undefined)`.
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
- **No `nestjs-pino`**: the adapter runs on the shared pino instance
  (`loggerInstance`), keeping access-log bytes and redaction identical.
- **class-validator/class-transformer deferred**: body parsing stays
  hand-rolled in controllers so HTTP behavior is byte-preserved; adopting
  `ValidationPipe` is a separate, consciously-verified step.

## Commands

- Dev: `pnpm run dev` — the orchestrator spawns `scripts/nest-dev.js`,
  which runs `nest start --watch` (server 8629, then both Vite dev
  servers).
- Build: `pnpm run build` builds both webs and the server (`dist/`).
- Start: `pnpm run start` builds, then runs
  `node --env-file-if-exists=.env apps/server/dist/main.js`.
- Test: `pnpm run test` builds the server first (the root integration
  tests spawn `dist/main.js`).

Docker (when it lands): the image must use Node ≥ 22.19 (pi-ai's engines
requirement + `engine-strict=true`).
