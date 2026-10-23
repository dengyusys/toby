/**
 * Toby server entry point (Nest over the Fastify adapter): resolve config,
 * assemble the domain modules, build the app, listen. Each domain is one
 * assembly line; cross-domain wiring happens only here in the composition
 * root. Runs from the nest build output (dist/main.js).
 */

import { resolveConfig } from "./infrastructure/config/config.ts";
import { getLogger } from "./infrastructure/logging/logger.ts";
import { createNestServer } from "./infrastructure/http/nest-app.ts";
import { SystemModule } from "./domains/system/system.module.ts";
import { createLedgerModule } from "./domains/ledger/ledger.module.ts";
import { createAuthModule } from "./domains/auth/auth.module.ts";

async function main(): Promise<void> {
  const config = resolveConfig();
  const logger = getLogger(config);

  // One line per domain; later domains only add lines here.
  const ledger = await createLedgerModule(config, { logger });
  const auth = createAuthModule(config);

  const server = await createNestServer({
    webRoot: config.paths.webRoot,
    mobileWebRoot: config.paths.mobileWebRoot,
    domainModules: [SystemModule, ledger, auth.module],
    requestGuard: auth.requestGuard,
    trustProxy: config.trustProxy,
    logger,
  });

  try {
    await server.listen(config.server.host, config.server.port);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      logger.error(
        { port: config.server.port },
        "port already in use; free it or change TOBY_PORT",
      );
    } else {
      logger.error({ err: error }, "listen failed");
    }
    process.exitCode = 1;
    await server.close();
    return;
  }

  logger.info(
    { host: config.server.host, port: config.server.port, pid: process.pid },
    "toby server started",
  );
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error("toby server failed to start", error);
}
