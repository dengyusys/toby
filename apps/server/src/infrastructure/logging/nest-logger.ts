/**
 * Application and framework logging: the built-in Nest ConsoleLogger in
 * JSON mode — one machine-readable record per line on stdout, structured
 * params (the official logger recipe). TOBY_LOG_LEVEL keeps the shared
 * vocabulary (trace..silent, validated in config); this maps it onto the
 * built-in logger's levels. HTTP access logging is Fastify's own
 * (logger: { level }) and stays unredacted by decision — Fastify's
 * default serializers log method/url/host/IP only, never headers.
 */

import { ConsoleLogger, type LogLevel } from "@nestjs/common";

// TOBY_LOG_LEVEL → enabled built-in levels (most verbose first); "silent"
// turns the whole application logger off, `new Logger` facade included.
const NEST_LEVELS: Readonly<Record<string, readonly LogLevel[] | false>> = {
  trace: ["verbose", "debug", "log", "warn", "error", "fatal"],
  debug: ["debug", "log", "warn", "error", "fatal"],
  info: ["log", "warn", "error", "fatal"],
  warn: ["warn", "error", "fatal"],
  error: ["error", "fatal"],
  fatal: ["fatal"],
  silent: false,
};

/** Build the application logger for a TOBY_LOG_LEVEL value. */
export function createNestLogger(level: string): ConsoleLogger | false {
  const logLevels = NEST_LEVELS[level];
  if (logLevels === false) {
    return false;
  }
  return new ConsoleLogger({
    json: true,
    ...(logLevels ? { logLevels: [...logLevels] } : {}),
  });
}
