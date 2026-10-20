/**
 * Runtime configuration: resolves TOBY_* environment variables once at
 * startup. Values are injected (tests pass a custom env); nothing resolves
 * the process environment at import time.
 */

import path from "node:path";
import { repositoryRoot } from "../../utils/paths/index.ts";
import type { DbDialect } from "../db/types.ts";
import type { AiTransportConfig } from "../ai/types.ts";

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

export interface AuthConfig {
  /** A configured password hash enables authentication. */
  enabled: boolean;
  passwordHash: string;
  sessionTtlMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  secureCookie: boolean;
}

export interface TobyConfig {
  server: ServerConfig;
  paths: PathConfig;
  db: DatabaseConfig;
  ai: AiTransportConfig;
  auth: AuthConfig;
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

function resolveTimeout(
  value: string | undefined,
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const timeout = Number(value ?? String(fallback));
  if (
    !Number.isInteger(timeout) ||
    timeout < bounds.min ||
    timeout > bounds.max
  ) {
    throw new Error(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
  return timeout;
}

/** AI transport; an empty key keeps the AI paths plainly unavailable. */
function resolveAiConfig(env: Env): AiTransportConfig {
  const apiKey = env.TOBY_AI_API_KEY ?? "";
  const model = env.TOBY_AI_MODEL ?? "";
  if (apiKey && !model) {
    throw new Error(
      "TOBY_AI_MODEL is required when TOBY_AI_API_KEY is configured",
    );
  }
  return {
    baseUrl: env.TOBY_AI_BASE_URL || "https://api.openai.com/v1",
    apiKey,
    model,
    timeoutMs: resolveTimeout(
      env.TOBY_AI_TIMEOUT_MS,
      "TOBY_AI_TIMEOUT_MS",
      30_000,
      { min: 1_000, max: 120_000 },
    ),
  };
}

const SCRYPT_HASH_PATTERN =
  /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

/** Auth stays off until a password hash is explicitly configured. */
function resolveAuthConfig(env: Env): AuthConfig {
  const passwordHash = env.TOBY_AUTH_PASSWORD_HASH ?? "";
  if (passwordHash && !SCRYPT_HASH_PATTERN.test(passwordHash)) {
    throw new Error(
      "TOBY_AUTH_PASSWORD_HASH must be an scrypt$N$r$p$salt$hash value from scripts/hash-password.js",
    );
  }
  const ttlHours = Number(env.TOBY_AUTH_SESSION_TTL_HOURS ?? "168");
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 8760) {
    throw new Error(
      "TOBY_AUTH_SESSION_TTL_HOURS must be an integer between 1 and 8760",
    );
  }
  const rateLimitMax = Number(env.TOBY_AUTH_RATE_LIMIT_MAX ?? "5");
  if (
    !Number.isInteger(rateLimitMax) ||
    rateLimitMax < 1 ||
    rateLimitMax > 100
  ) {
    throw new Error(
      "TOBY_AUTH_RATE_LIMIT_MAX must be an integer between 1 and 100",
    );
  }
  return {
    enabled: passwordHash !== "",
    passwordHash,
    sessionTtlMs: ttlHours * 3_600_000,
    rateLimitMax,
    rateLimitWindowMs: resolveTimeout(
      env.TOBY_AUTH_RATE_LIMIT_WINDOW_MS,
      "TOBY_AUTH_RATE_LIMIT_WINDOW_MS",
      60_000,
      { min: 1_000, max: 3_600_000 },
    ),
    secureCookie: env.TOBY_AUTH_SECURE_COOKIE === "true",
  };
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
    ai: resolveAiConfig(env),
    auth: resolveAuthConfig(env),
    logLevel: env.TOBY_LOG_LEVEL || "info",
  };
}
