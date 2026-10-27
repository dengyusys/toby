/**
 * Toby server entry point: resolve config, build the Nest application
 * over the Fastify adapter, apply the Fastify-level contract, listen.
 * Each domain is one import in AppModule; cross-domain wiring happens
 * only in the composition root (app.module.ts and this file). Runs from
 * the nest build output (dist/main.js).
 */

import { Logger } from "@nestjs/common";
import { resolveConfig } from "./infrastructure/config/config.ts";
import { createNestLogger } from "./infrastructure/logging/nest-logger.ts";
import {
  applyHttpContract,
  createTobyAdapter,
} from "./infrastructure/http/nest-app.ts";
import { createAppModule } from "./app.module.ts";
import { SessionGuard } from "./domains/auth/session.guard.ts";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

async function main(): Promise<void> {
  const config = resolveConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    createAppModule(config),
    createTobyAdapter({
      trustProxy: config.trustProxy,
      logLevel: config.logLevel,
    }),
    // Built-in logger in JSON mode for app and framework logs (false when
    // TOBY_LOG_LEVEL=silent); Fastify's own access log runs at the same
    // level.
    // abortOnError off: a DI failure surfaces as a normal error instead
    // of process.abort() eating it (vitest workers died with SIGABRT).
    { logger: createNestLogger(config.logLevel), abortOnError: false },
  );

  const logger = new Logger("Bootstrap");
  const staticLogger = new Logger("StaticAssets");

  const server = await applyHttpContract(app, {
    webRoot: config.paths.webRoot,
    mobileWebRoot: config.paths.mobileWebRoot,
    warn: (message) => staticLogger.warn(message),
    // The session guard comes straight from the container (providers
    // instantiate during NestFactory.create above); APP_GUARD registration
    // is broken under the ESM tooling
    // (docs/decisions/idiomatic-nest-services.md).
    globalGuard: app.get(SessionGuard),
  });

  try {
    await server.listen(config.server.host, config.server.port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      logger.error("port already in use; free it or change TOBY_PORT", {
        port: config.server.port,
      });
    } else {
      logger.error("listen failed", { err: error });
    }
    process.exitCode = 1;
    await server.close();
    return;
  }

  // The built-in JSON record carries pid and timestamp already.
  logger.log("toby server started", {
    host: config.server.host,
    port: config.server.port,
  });
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error("toby server failed to start", error);
}
