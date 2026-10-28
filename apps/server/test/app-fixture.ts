/**
 * The shared test app fixture: the same modules production assembles, with
 * per-case config/clock and `overrideProvider` for the rest. Requests go
 * through supertest against a real server, so every assertion crosses the wire.
 */

import "reflect-metadata";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { DynamicModule, Type } from "@nestjs/common";
import { NodeAdapter, type NestNodeApplication } from "@nestjs/platform-node";
import type { TobyConfig } from "../src/infrastructure/config/config.ts";
import { HttpModule } from "../src/infrastructure/http/http.module.ts";
import { SharedProvidersModule } from "../src/infrastructure/providers/shared-providers.module.ts";
import {
  CLOCK,
  TOBY_CONFIG,
  type Clock,
} from "../src/infrastructure/providers/shared-tokens.ts";
import { REQUEST_BODY_LIMIT_BYTES } from "../src/main.ts";

export interface TestAppOptions {
  /** Per-case config (tests resolve their own env into temp data roots). */
  config: TobyConfig;
  /** The modules under test; the fixture adds the shared providers. */
  modules: Array<Type<unknown> | DynamicModule>;
  /** Injectable clock; tests typically pass a mutable closure. */
  clock?: Clock;
  /** Per-case provider overrides (LEDGER_TIMING, LEDGER_EXTRACTOR, ...). */
  overrides?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createTestApp(
  options: TestAppOptions,
): Promise<NestNodeApplication> {
  let builder = Test.createTestingModule({
    imports: [SharedProvidersModule.forRoot(), HttpModule, ...options.modules],
  });
  // Every per-case value takes the same path: the config replaces the
  // container's own resolution (so a test run never reads the process
  // environment), and the clock joins it when a case needs to drive time.
  builder = builder.overrideProvider(TOBY_CONFIG).useValue(options.config);
  if (options.clock) {
    builder = builder.overrideProvider(CLOCK).useValue(options.clock);
  }
  if (options.overrides) {
    builder = options.overrides(builder);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestNodeApplication>(
    new NodeAdapter(),
    { logger: false, abortOnError: false },
  );
  // The only bootstrap-level default production also applies that the tests
  // need; the no-store policy and the SPA roots come from HttpModule, and the
  // latter mount from their own `onModuleInit`.
  app.useBodyParser("json", { limit: REQUEST_BODY_LIMIT_BYTES });
  app.useBodyParser("urlencoded", { limit: REQUEST_BODY_LIMIT_BYTES });
  await app.init();
  return app;
}
