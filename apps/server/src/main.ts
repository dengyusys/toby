/**
 * Server entry point: the standard Nest bootstrap. Only the listen target is
 * resolved here; config, domains and the HTTP shell come from `AppModule`. No
 * logger is configured — the server keeps no application log.
 */

import { pathToFileURL } from "node:url";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter, type NestNodeApplication } from "@nestjs/platform-node";
import { AppModule } from "./app.module.ts";
import { resolveListenTarget } from "./infrastructure/config/config.ts";
import { REQUEST_BODY_LIMIT_BYTES } from "./infrastructure/http/body-limit.ts";

async function bootstrap(): Promise<void> {
  const target = resolveListenTarget();

  const app = await NestFactory.create<NestNodeApplication>(
    AppModule,
    new NodeAdapter(),
    // abortOnError off: a DI failure surfaces instead of process.abort().
    { abortOnError: false },
  );

  // Before init(): a parser registered under the same name replaces Nest's
  // 100 KiB default.
  app.useBodyParser("json", { limit: REQUEST_BODY_LIMIT_BYTES });
  app.useBodyParser("urlencoded", { limit: REQUEST_BODY_LIMIT_BYTES });
  app.enableShutdownHooks();

  try {
    await app.listen(target.port, target.host);
  } catch (error) {
    process.exitCode = 1;
    await app.close();
    // Rethrown for the one line a failed start must still print.
    throw (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      ? new Error(
          `port ${target.port} already in use; free it or change TOBY_PORT`,
        )
      : error;
  }
}

// Run only as the process entry (`node dist/main.js`): importing this module
// must not boot a server. Two spellings count — `pnpm run start` and the
// Dockerfile pass the file with `.js`, while `nest start` spawns it
// extensionless (`node dist/main`), which Node resolves to the same file.
const entryUrl = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (
  entryUrl === import.meta.url ||
  (entryUrl !== undefined && `${entryUrl}.js` === import.meta.url)
) {
  try {
    await bootstrap();
  } catch (error) {
    process.exitCode = 1;
    console.error("toby server failed to start", error);
  }
}
