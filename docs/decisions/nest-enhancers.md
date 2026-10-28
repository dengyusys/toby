# Nest Enhancers and Request Validation

English | [简体中文](nest-enhancers.zh.md)

Cross-cutting request-pipeline pieces are standard Nest `APP_*` enhancers —
`APP_GUARD` for the session guard, `APP_FILTER` for the error envelope,
`APP_PIPE` for body validation — and request bodies are validated with Zod 4
schemas through Nest's built-in `StandardSchemaValidationPipe`. Both rules
reverse verdicts the deleted `idiomatic-nest-services` ADR had pinned; this
ADR restores the decision chain and re-homes the rules from that ADR which
still hold.

## Why the reversals

- **`APP_*` enhancers register cleanly now.** The old ADR's "metatype is
  not a constructor" failure was reproduced against the Fastify-adapter-era
  assembly (Nest 12.2/12.3 under vitest's module runner, with and without
  swc). It does not reproduce on the current platform-node stack: every
  fixture-built test app registers the filter and pipe through
  `HttpModule`, the auth suites add `SessionGuard` through `APP_GUARD`, and
  the spawned-`dist/main.js` integration suite exercises the same
  registrations through NestFactory. The behavior is pinned where it
  matters: the percent-encoded-path guard cases (`APP_GUARD`), the error
  envelope (`APP_FILTER`), and the 400 / 413 envelope mapping (`APP_PIPE`
  plus the adapter error path).
- **Zod replaces TypeBox as the shape gate.** The tool schemas moved to
  Zod (see [ai-pi-runtime.md](ai-pi-runtime.md)); Zod 4 implements the
  Standard Schema interface, so Nest's built-in
  `StandardSchemaValidationPipe` consumes those schemas with zero custom
  pipe code. One schema definition stays both the model-facing tool
  contract and the server's shape gate — the single-definition property
  the old ADR kept TypeBox for. The old worry, that a global pipe would
  swallow body parsing and the transport error mapping, dissolved with the
  adapter switch: the platform-node error path feeds the deliberate
  envelope (`BAD_REQUEST` / `PAYLOAD_TOO_LARGE`), pinned by the
  error-handler suite.

## Decisions

- `HttpModule` (`infrastructure/http/http.module.ts`) owns the global
  `APP_FILTER` (`HttpExceptionFilter`) and `APP_PIPE`
  (`StandardSchemaValidationPipe`); `AuthModule` registers `SessionGuard`
  through `APP_GUARD`. A domain registers enhancers only for its own
  concerns — never for another domain's.
- Route parameters declare their schema inline — `@Body({ schema })` with
  the Zod objects in `dto/login.dto.ts` and `dto/create-proposal.dto.ts`.
  Shape failures surface as the transport-level `BAD_REQUEST` envelope
  before any domain code runs; semantic validation stays in the domain
  (`ledger/validation.ts`).
- The decorator-metadata premise (constructor injection under vitest) is
  unchanged and still guarded by
  `test/infrastructure/di-metadata.test.ts`.

## Still load-bearing from the deleted ADR

- `SessionGuard` exempts routes through `@Public()` metadata — never by
  parsing the request URL; the percent-encoding dodge is a standing
  regression case. `GET /api/system/health` is `@Public` (the Docker
  healthcheck target).
- No `@nestjs/schedule`: services own their interval timers through
  `onModuleInit` / `onModuleDestroy`, keeping every time parameter
  injectable.
- The store owns its database — lazy memoized open, closed on module
  destruction ([db-adapter.md](db-adapter.md)).
- Config resolves once at startup, inside the container
  (`SharedProvidersModule.forRoot`, `useFactory: resolveConfig`), so a bad
  environment fails `NestFactory.create`; the typed object enters DI as the
  `TOBY_CONFIG` value and tests override the token. `@nestjs/config` stays
  out.
