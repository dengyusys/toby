/**
 * Server entry point: resolve the config, assemble the application, listen,
 * and close cleanly on a termination signal. Running this module starts the
 * server — tests import `app.ts` instead. Config failures surface as a plain
 * startup error. The application logs through pino (see `app.ts`); only
 * these bootstrap-time failures still print one plain stderr line.
 */

import { createApp } from "./app.ts";
import { resolveConfig } from "./infrastructure/config/config.ts";

/** How long a graceful close may take before the process exits anyway. */
const SHUTDOWN_DEADLINE_MS = 10_000;

/** Termination requests: Ctrl+C, `docker stop` / kill, a closed terminal. */
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

async function bootstrap(): Promise<void> {
  const config = resolveConfig();
  const target = config.server;
  const app = await createApp({ config });

  // The framework installs no signal handling of its own. The first signal
  // closes the app (sweepers stop, the domain databases close); repeats
  // are ignored, and the deadline ends a close that hangs.
  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    setTimeout(() => {
      console.error("toby server: shutdown timed out");
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    app.close().then(
      () => process.exit(process.exitCode ?? 0),
      (error: unknown) => {
        console.error(
          "toby server: shutdown failed",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      },
    );
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, shutdown);
  }

  try {
    await app.listen({ port: target.port, host: target.host });
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

try {
  await bootstrap();
} catch (error) {
  process.exitCode = 1;
  console.error("toby server failed to start", error);
}
