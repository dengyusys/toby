/**
 * Runtime configuration: resolves TOBY_* environment variables once at
 * startup. Values are injected (tests pass a custom env); nothing resolves
 * the process environment at import time.
 */

import path from "node:path";
import { repositoryRoot } from "../../utils/paths/index.ts";

export { repositoryRoot };

/** Environment view: keys may be missing. */
export type Env = Record<string, string | undefined>;

export interface ServerConfig {
  host: string;
  port: number;
}

export interface PathConfig {
  dataRoot: string;
  webRoot: string;
  mobileWebRoot: string;
}

export interface TobyConfig {
  server: ServerConfig;
  paths: PathConfig;
  logLevel: string;
}

/**
 * Validate the listen host: loopback for normal runs, plus 0.0.0.0 for
 * containers (Docker maps the published port back to 127.0.0.1 on the host,
 * so the container must be allowed to bind all interfaces).
 */
function resolveHost(value: string | undefined): string {
  const host = value || "127.0.0.1";
  if (
    host === "0.0.0.0" ||
    host === "localhost" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  ) {
    return host;
  }
  throw new Error(
    "TOBY_HOST must be a loopback address (or 0.0.0.0 in a container)",
  );
}

function resolvePort(value: string | undefined): number {
  const port = Number(value ?? "8629");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TOBY_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function resolveRelative(value: string | undefined, fallback: string): string {
  return value ? path.resolve(repositoryRoot, value) : fallback;
}

export function resolveConfig(options: { env?: Env } = {}): TobyConfig {
  const env = options.env ?? process.env;
  return {
    server: {
      host: resolveHost(env.TOBY_HOST),
      port: resolvePort(env.TOBY_PORT),
    },
    paths: {
      dataRoot: resolveRelative(
        env.TOBY_DATA_ROOT,
        path.join(repositoryRoot, "data"),
      ),
      webRoot: path.resolve(repositoryRoot, "apps/web/dist"),
      mobileWebRoot: path.resolve(repositoryRoot, "apps/web-mobile/dist"),
    },
    logLevel: env.TOBY_LOG_LEVEL || "info",
  };
}
