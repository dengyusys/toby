/**
 * Runtime logging: one shared pino root instance writing JSON lines to
 * stdout (journald/docker collect it from there).
 *
 * Secrecy red line: request bodies and chat content never enter logs;
 * auth headers and cookies are redacted.
 */

import pino from "pino";
import type { TobyConfig } from "../config/config.ts";

export type Logger = pino.Logger;

// Redact paths aligned with the Fastify access-log req serializer shape.
const REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie"];

export function createLogger(options: {
  level: string;
  stream?: pino.DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    options.stream,
  );
}

export function getLogger(config: Pick<TobyConfig, "logLevel">): Logger {
  return createLogger({ level: config.logLevel });
}
