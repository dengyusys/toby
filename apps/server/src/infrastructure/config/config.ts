/**
 * Runtime configuration: resolves TOBY_* environment variables once at
 * startup. Values are injected (tests pass a custom env); nothing resolves
 * the process environment at import time.
 */

import path from "node:path";
import { repositoryRoot } from "../../utils/paths/index.ts";
import type { DbDialect } from "../db/types.ts";
import type { AiRuntimeConfig } from "../ai/types.ts";

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
  /** Absent = AI paths disabled (the one-sentence ledger path answers 501). */
  ai?: AiRuntimeConfig;
  auth: AuthConfig;
  /**
   * Trust X-Forwarded-For from a reverse proxy in front of the server, so
   * request.ip (and the login rate limiter) see real client addresses.
   * Enable only behind a proxy you control — a directly exposed server
   * would let clients spoof the header and bypass per-IP limits.
   */
  trustProxy: boolean;
  logLevel: string;
}

function resolveBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be "true" or "false"`);
}

// Validate the listen host: loopback for normal runs, plus 0.0.0.0 for
// containers (Docker maps the published port back to 127.0.0.1 on the host,
// so the container must be allowed to bind all interfaces).
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

/**
 * pino rejects unknown levels with a library-internal error; validate here
 * so a typo in TOBY_LOG_LEVEL fails with a config-shaped message instead.
 */
const LOG_LEVELS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

function resolveLogLevel(value: string | undefined): string {
  const level = value || "info";
  if (!LOG_LEVELS.has(level)) {
    throw new Error(
      `TOBY_LOG_LEVEL must be one of: ${[...LOG_LEVELS].join(", ")}`,
    );
  }
  return level;
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

/**
 * AI runtime: TOBY_AI_MODEL is pi-ai's "provider/model" pair (e.g.
 * "zai/glm-4.7"). Provider credentials live in pi-ai's per-provider
 * environment variables (e.g. ZAI_API_KEY) or its credential store — not
 * here. An unset model keeps the AI paths plainly unavailable.
 */
const AI_MODEL_PATTERN = /^([a-z0-9][a-z0-9_-]*)\/(\S+)$/;

function resolveAiConfig(env: Env): AiRuntimeConfig | undefined {
  // The timeout is validated even when the model is unset, so a typo in
  // TOBY_AI_TIMEOUT_MS fails at startup instead of hiding until the day AI
  // is actually enabled.
  const timeoutMs = resolveTimeout(
    env.TOBY_AI_TIMEOUT_MS,
    "TOBY_AI_TIMEOUT_MS",
    30_000,
    { min: 1_000, max: 120_000 },
  );
  const model = (env.TOBY_AI_MODEL ?? "").trim();
  if (!model) {
    return undefined;
  }
  if (!AI_MODEL_PATTERN.test(model)) {
    throw new Error(
      'TOBY_AI_MODEL must be a "provider/model" pair (e.g. "zai/glm-4.7")',
    );
  }
  return { model, timeoutMs };
}

// The generator (scripts/hash-password.js) fixes the scrypt parameters;
// pinning them here rejects malformed hashes at startup instead of at
// login time.
const SCRYPT_HASH_PATTERN =
  /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

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
    secureCookie: resolveBoolean(
      env.TOBY_AUTH_SECURE_COOKIE,
      "TOBY_AUTH_SECURE_COOKIE",
      false,
    ),
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
    trustProxy: resolveBoolean(env.TOBY_TRUST_PROXY, "TOBY_TRUST_PROXY", false),
    logLevel: resolveLogLevel(env.TOBY_LOG_LEVEL),
  };
}
