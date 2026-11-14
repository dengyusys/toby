/**
 * Runtime configuration: resolves TOBY_* environment variables once at
 * startup. Values are injected (tests pass a custom env); nothing resolves
 * the process environment at import time.
 */

import path from "node:path";
import { repositoryRoot } from "../../utils/paths/index.ts";
import type { DbDialect } from "../db/types.ts";
import type { AiRuntimeConfig } from "../model/types.ts";
import {
  AI_TIMEOUT_BOUNDS,
  DEFAULT_AI_TIMEOUT_MS,
  validateModelSpec,
} from "../model/validation.ts";

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

/**
 * Dev-only page redirects: when set, the SPA entries bounce to the vite dev
 * servers instead of serving the dist builds (which go stale under vite).
 * `scripts/server-dev.js` sets the variables; production never does.
 */
export interface WebRedirectConfig {
  /** PC dev origin, no trailing slash (e.g. http://localhost:8630). */
  pc: string;
  /** Mobile dev origin including its base path (e.g. http://localhost:8631/m). */
  mobile: string;
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
  secureCookie: boolean;
}

export interface TobyConfig {
  server: ServerConfig;
  paths: PathConfig;
  db: DatabaseConfig;
  /** Absent = AI paths disabled (the one-sentence ledger path answers 501). */
  ai?: AiRuntimeConfig;
  /** Absent = serve the dist builds (production); set = dev redirects. */
  devWebRedirect?: WebRedirectConfig;
  auth: AuthConfig;
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

// Relative values resolve against the repository root, never the process
// cwd — the layout inside the Docker image depends on it.
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

/**
 * AI runtime: TOBY_AI_MODEL is pi-ai's "provider/model" pair (e.g.
 * "zai/glm-4.7"). Provider credentials live in pi-ai's per-provider
 * environment variables (e.g. DEEPSEEK_API_KEY) or its credential store — not
 * here. An unset model keeps the AI paths plainly unavailable. The spec
 * pattern and timeout bounds live in infrastructure/model/validation.ts,
 * shared with the settings domain.
 */
function resolveAiConfig(env: Env): AiRuntimeConfig | undefined {
  // The timeout is validated even when the model is unset, so a typo in
  // TOBY_AI_TIMEOUT_MS fails at startup instead of hiding until the day AI
  // is actually enabled.
  const timeoutMs = resolveTimeout(
    env.TOBY_AI_TIMEOUT_MS,
    "TOBY_AI_TIMEOUT_MS",
    DEFAULT_AI_TIMEOUT_MS,
    AI_TIMEOUT_BOUNDS,
  );
  const rawModel = env.TOBY_AI_MODEL ?? "";
  if (!rawModel.trim()) {
    return undefined;
  }
  return { model: validateModelSpec(rawModel), timeoutMs };
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
  return {
    enabled: passwordHash !== "",
    passwordHash,
    sessionTtlMs: ttlHours * 3_600_000,
    secureCookie: resolveBoolean(
      env.TOBY_AUTH_SECURE_COOKIE,
      "TOBY_AUTH_SECURE_COOKIE",
      false,
    ),
  };
}

/** One redirect origin: an absolute http(s) URL, trailing slashes trimmed. */
function resolveRedirectOrigin(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${name} must be an absolute http(s) URL (e.g. http://localhost:8630)`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be an absolute http(s) URL without query or fragment`,
    );
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function resolveDevWebRedirect(env: Env): WebRedirectConfig | undefined {
  const pc = resolveRedirectOrigin(
    env.TOBY_DEV_PC_ORIGIN,
    "TOBY_DEV_PC_ORIGIN",
  );
  const mobile = resolveRedirectOrigin(
    env.TOBY_DEV_MOBILE_ORIGIN,
    "TOBY_DEV_MOBILE_ORIGIN",
  );
  if (pc !== undefined && mobile !== undefined) {
    return { pc, mobile };
  }
  if (pc !== undefined || mobile !== undefined) {
    throw new Error(
      "TOBY_DEV_PC_ORIGIN and TOBY_DEV_MOBILE_ORIGIN must be set together",
    );
  }
  return undefined;
}

export function resolveConfig(options: { env?: Env } = {}): TobyConfig {
  const env = options.env ?? process.env;
  return {
    server: resolveListenTarget(env),
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
    devWebRedirect: resolveDevWebRedirect(env),
    auth: resolveAuthConfig(env),
  };
}

/**
 * The listen target alone: what `main.ts` needs before the container exists.
 * Same validators as `resolveConfig`, so a bad port still fails the start.
 */
export function resolveListenTarget(env: Env = process.env): ServerConfig {
  return {
    host: resolveHost(env.TOBY_HOST),
    port: resolvePort(env.TOBY_PORT, "TOBY_PORT", 8629),
  };
}
