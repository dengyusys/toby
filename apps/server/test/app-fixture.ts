/**
 * The shared test app fixture: the same shell production assembles, with a
 * per-case config and the test's own domain set (clocks and fakes go into
 * the domain plugins the test mounts). Requests go through fastify's
 * `inject`, so every assertion crosses the full request lifecycle; the root
 * integration test separately covers the real socket.
 */

import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import pino from "pino";
import { createApp, type DomainMount } from "../src/app.ts";
import type {
  PathConfig,
  TobyConfig,
} from "../src/infrastructure/config/config.ts";

// Static roots that never exist: every fixture app looks like a fresh clone
// without web builds, whatever the developer machine has built.
const missingStaticRoots = {
  webRoot: path.join(tmpdir(), "toby-test-static-missing", "web"),
  mobileWebRoot: path.join(tmpdir(), "toby-test-static-missing", "mobile"),
};

export interface TestAppOptions {
  /** Per-case config (tests resolve their own env into temp data roots). */
  config: TobyConfig;
  /**
   * Real SPA roots for the tests that exercise static serving; every other
   * test gets roots that never exist, so static serving stays out of the way.
   */
  staticRoots?: Pick<PathConfig, "webRoot" | "mobileWebRoot">;
  /** The domains under test (a subset, fakes, or `productionDomains`). */
  domains: readonly DomainMount[];
  /**
   * Logger for assertions; the default is a real pino at level "silent", so
   * request logging stays wired yet prints nothing.
   */
  logger?: FastifyBaseLogger;
}

export async function createTestApp(
  options: TestAppOptions,
): Promise<FastifyInstance> {
  const staticRoots = options.staticRoots ?? missingStaticRoots;
  const config: TobyConfig = {
    ...options.config,
    paths: { ...options.config.paths, ...staticRoots },
  };
  const app = await createApp({
    config,
    domains: options.domains,
    logger:
      options.logger ?? pino({ name: "toby-server-test", level: "silent" }),
  });
  await app.ready();
  return app;
}
