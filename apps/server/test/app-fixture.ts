/**
 * The shared test app fixture: assembles the app through @nestjs/testing
 * — SharedProvidersModule carries per-case config/clock into the DI
 * container, domain modules (or module subsets) arrive as imports, and
 * per-case values (LEDGER_TIMING, LEDGER_EXTRACTOR, ...) arrive through
 * overrideProvider. The Fastify-level contract (filter, static roots,
 * init) is applied exactly like production via applyHttpContract.
 */

import "reflect-metadata";
import { tmpdir } from "node:os";
import path from "node:path";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { CanActivate, DynamicModule, Type } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  applyHttpContract,
  createTobyAdapter,
  type NestServer,
} from "../src/infrastructure/http/nest-app.ts";
import type { TobyConfig } from "../src/infrastructure/config/config.ts";
import { SharedProvidersModule } from "../src/infrastructure/providers/shared-providers.module.ts";
import type { Clock } from "../src/infrastructure/providers/shared-tokens.ts";

// Static roots that never exist: static serving degrades to a warning,
// exactly like a fresh clone without web builds.
const missingStaticRoot = path.join(tmpdir(), "toby-test-static-missing");

export interface TestAppOptions {
  /** Per-case config (tests resolve their own env into temp data roots). */
  config: TobyConfig;
  /** The modules under test; the fixture adds the shared providers. */
  modules: Array<Type<unknown> | DynamicModule>;
  /** Injectable clock; tests typically pass a mutable closure. */
  clock?: Clock;
  /** Per-case provider overrides (LEDGER_TIMING, LEDGER_EXTRACTOR, ...). */
  overrides?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  trustProxy?: boolean;
  /**
   * The global guard, or a resolver invoked before init — compile() has
   * already instantiated providers, so `app.get(SomeGuard)` resolves
   * there. This mirrors main.ts's composition-root guard wiring.
   */
  globalGuard?: CanActivate | ((app: NestFastifyApplication) => CanActivate);
}

export async function createTestApp(
  options: TestAppOptions,
): Promise<NestServer> {
  let builder = Test.createTestingModule({
    imports: [
      SharedProvidersModule.forRoot(options.config, {
        clock: options.clock,
      }),
      ...options.modules,
    ],
  });
  if (options.overrides) {
    builder = options.overrides(builder);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createTobyAdapter({ trustProxy: options.trustProxy }),
    { logger: false, abortOnError: false },
  );
  const globalGuard =
    typeof options.globalGuard === "function"
      ? options.globalGuard(app)
      : options.globalGuard;
  return applyHttpContract(app, {
    webRoot: path.join(missingStaticRoot, "web"),
    mobileWebRoot: path.join(missingStaticRoot, "mobile"),
    globalGuard,
  });
}
