# Idiomatic Nest Services: Classes, Constructor Injection, Metadata Guards

English | [简体中文](idiomatic-nest-services.zh.md)

The server keeps the NestJS-over-Fastify stack from
[nestjs-server-stack.md](nestjs-server-stack.md) but abandons the
"shell-only" migration style: services are `@Injectable()` classes with
constructor injection, domain modules are declarative `@Module` classes,
authentication is a real Nest guard with `@Public()` metadata exemptions,
and tests assemble apps through `@nestjs/testing`.

## Why

- **The blocking constraint was stale.** The previous ADR mandated
  `@Inject(token)` property injection because vitest's esbuild transform
  emits no decorator metadata. Two facts dissolved that: the server's
  current lockfile resolves vitest to a Vite 8 (oxc) pipeline that
  _already_ emits `design:paramtypes`, and the official NestJS recipe
  (`unplugin-swc`) pins the behavior explicitly regardless of which vite
  peer pnpm picks. Both paths are verified by
  `apps/server/test/infrastructure/di-metadata.test.ts`, which fails loud
  the moment the metadata stops being emitted.
- **Mainstream idioms, house boundaries.** Constructor injection over
  class tokens, `forRoot` value modules, lifecycle hooks and
  `Test.createTestingModule` are the shape every Nest developer (and
  model) already knows — same reasoning as the original migration, taken
  to the service layer. The vertical-domain boundaries
  (vertical-domains.md) are untouched and still machine-enforced.

## Decisions

- **Toolchain.** `apps/server/vitest.config.ts` runs all server tests
  through `unplugin-swc` (`@swc/core` binaries ship as
  optionalDependencies; its postinstall stays blocked in
  `pnpm-workspace.yaml`). The metadata regression test guards the
  premise. `nest build` (tsc) is unchanged.
- **Services and stores are classes.** `SystemService`, `AuthService`,
  `LedgerStore`, `LedgerService` take dependencies through constructors.
  Value-shaped or optional dependencies stay on tokens:
  `TOBY_CONFIG` / `CLOCK` (provided globally by
  `SharedProvidersModule.forRoot` in the composition root) and the
  ledger's `LEDGER_EXTRACTOR` / `LEDGER_TIMING` (test-overridable knobs).
  Logging is the built-in logger's `new Logger(X.name)` facade — no
  injected logger token; tests capture via `Logger.overrideLogger`.
  Per-class service tokens (`SYSTEM_SERVICE`, `AUTH_SERVICE`,
  `LEDGER_SERVICE`) are gone, as are the fake `*_LIFECYCLE` providers —
  services own their background timers through the standard lifecycle
  hooks.
- **Config resolves once, before Nest.** `resolveConfig()` runs in the
  composition root (fail-fast ordering unchanged) and enters the
  container as the `TOBY_CONFIG` value. `@nestjs/config` is deliberately
  not adopted: the resolved typed object is the single validated source,
  tests inject explicit env objects rather than `process.env`, and the
  Fastify adapter needs config before the container exists.
- **Validation stays typebox; no global ValidationPipe.** The ledger
  draft schema is simultaneously the model-facing tool contract and the
  server's shape gate — a class-validator DTO would split that into two
  drift-capable definitions. A global pipe would also take over body
  parsing and threaten the `FST_ERR_*` → `INVALID_JSON` /
  `PAYLOAD_TOO_LARGE` envelope mapping. The unused
  `class-validator` / `class-transformer` dependencies are removed.
- **Auth is a guard with metadata exemptions.** `SessionGuard`
  (`@Injectable`, `Reflector`) decides exemptions from `@Public()`
  route metadata — never from parsing the request URL. The old guard
  matched raw URL prefixes while the router matches decoded paths, so
  `/%61pi/ledger/months` reached a guarded route as "not under /api"
  (verified exploitable; now a regression test). `GET /api/system/health`
  is `@Public` — it is the Docker healthcheck target and carries no
  business data (user decision 2026-10-27; realigns code with
  `docs/features/system.md`). The 405 discriminator in the exception
  filter decodes the path for the same reason.
- **Guard installation is explicit.** `APP_GUARD` (any `APP_*` enhancer
  provider) is unusable under the current tooling: Nest 12 ESM inside
  vitest's module runner fails any `APP_GUARD`/`APP_FILTER` registration
  with "metatype is not a constructor" — reproduced with a
  zero-dependency guard on both the TestingInjector and NestFactory
  paths, with and without swc, on 12.2.0 and 12.3.2 (an internal wrapper
  with a nil metatype is constructed). The composition root therefore
  hands the container-built guard to `applyHttpContract`
  (`useGlobalGuards`, installed before `app.init()`; main passes a
  lazily-resolving delegate). Re-evaluate when Nest fixes ESM enhancer
  registration.
- **The db port stays; the store owns its database.** `LedgerStore`
  opens the domain database and applies migrations behind a memoized
  lazy open (first caller pays, everyone shares) and closes it on
  `OnModuleDestroy` — one provider, no extra token or factory indirection
  for a single consumer. See [db-adapter.md](db-adapter.md) for why no
  ORM.
- **No `@nestjs/schedule`.** The auth and ledger services run their
  sweep `setInterval` from `onModuleInit` and clear it in
  `OnModuleDestroy`, keeping every time parameter injectable (`CLOCK`,
  `LEDGER_TIMING`), which the test suite depends on. The ledger timer's
  teardown order ahead of the database close is guaranteed by Nest's
  descending-dependency-depth destruction — do not break the
  LedgerService → LedgerStore dependency chain.
- **Testing.** HTTP-contract suites build apps through
  `test/app-fixture.ts`: `Test.createTestingModule` +
  `overrideProvider` for per-case values, `createNestApplication` with
  the same adapter and `applyHttpContract` as production. Unit suites
  construct classes directly (`new LedgerService(...)`). The black-box
  `test/http-contract.integration.test.ts` (spawned `dist/main.js`)
  remains the wire-contract arbiter and now also pins the public-health
  and encoded-path behaviors.

## What carries over unchanged

`RawErrorFastifyAdapter`, `app.init()` before `inject()`, the
decorated-root-module constraint (hence `createAppModule` remains a
factory), `abortOnError: false`, the exact-pinned Fastify 5.12.7, the
private `staticAssetsPlugin`, and the envelope-first response writing
(`sendJsonReply`) — all still load-bearing, all still tested.
