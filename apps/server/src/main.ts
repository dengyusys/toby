/**
 * Toby server entry point: resolve config, assemble domains, build the app,
 * listen. Each domain is one assembly line; cross-domain wiring happens only
 * here in the composition root.
 */

import { resolveConfig } from "./infrastructure/config/config.ts";
import { getLogger } from "./infrastructure/logging/logger.ts";
import { createServer } from "./infrastructure/http/app.ts";
import { assembleSystem } from "./domains/system/module.ts";

async function main(): Promise<void> {
  const config = resolveConfig();
  const logger = getLogger(config);

  // One line per domain; later domains only add lines here.
  const system = assembleSystem();

  const app = createServer({
    webRoot: config.paths.webRoot,
    mobileWebRoot: config.paths.mobileWebRoot,
    logger,
    domains: [system],
  });

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
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
    await app.close();
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
