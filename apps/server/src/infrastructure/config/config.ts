/**
 * Runtime configuration: resolves TOBY_* environment variables once at
 * startup. Values are injected (tests pass a custom env); nothing resolves
 * the process environment at import time.
 */

import path from "node:path";
import { repositoryRoot } from "../../utils/paths/index.ts";
import type { DbDialect } from "../db/types.ts";

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

export interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  databasePrefix: string;
}

export interface DatabaseConfig {
  dialect: DbDialect;
  mysql: MySqlConfig;
}

export interface TobyConfig {
  server: ServerConfig;
  paths: PathConfig;
  db: DatabaseConfig;
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

function resolvePort(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  const port = Number(value ?? String(fallback));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function resolveDialect(value: string | undefined): DbDialect {
  const dialect = value || "sqlite";
  if (dialect !== "sqlite" && dialect !== "mysql") {
    throw new Error("TOBY_DB_DIALECT must be 'sqlite' or 'mysql'");
  }
  return dialect;
}

const MYSQL_DATABASE_PREFIX = /^[A-Za-z0-9_]*$/;

/** MySQL connection target; read only when the mysql dialect is selected. */
function resolveDatabaseConfig(env: Env): DatabaseConfig {
  const databasePrefix = env.TOBY_DB_MYSQL_DATABASE_PREFIX || "toby_";
  if (!MYSQL_DATABASE_PREFIX.test(databasePrefix)) {
    throw new Error(
      "TOBY_DB_MYSQL_DATABASE_PREFIX must be letters, digits or underscores",
    );
  }
  return {
    dialect: resolveDialect(env.TOBY_DB_DIALECT),
    mysql: {
      host: env.TOBY_DB_MYSQL_HOST || "127.0.0.1",
      port: resolvePort(env.TOBY_DB_MYSQL_PORT, "TOBY_DB_MYSQL_PORT", 3306),
      user: env.TOBY_DB_MYSQL_USER || "toby",
      password: env.TOBY_DB_MYSQL_PASSWORD ?? "",
      databasePrefix,
    },
  };
}

function resolveRelative(value: string | undefined, fallback: string): string {
  return value ? path.resolve(repositoryRoot, value) : fallback;
}

export function resolveConfig(options: { env?: Env } = {}): TobyConfig {
  const env = options.env ?? process.env;
  return {
    server: {
      host: resolveHost(env.TOBY_HOST),
      port: resolvePort(env.TOBY_PORT, "TOBY_PORT", 8629),
    },
    paths: {
      dataRoot: resolveRelative(
        env.TOBY_DATA_ROOT,
        path.join(repositoryRoot, "data"),
      ),
      webRoot: path.resolve(repositoryRoot, "apps/web/dist"),
      mobileWebRoot: path.resolve(repositoryRoot, "apps/web-mobile/dist"),
    },
    db: resolveDatabaseConfig(env),
    logLevel: env.TOBY_LOG_LEVEL || "info",
  };
}
