/**
 * Config resolution: defaults, overrides, and validation failures —
 * all against an injected env, never the process environment.
 */

import { describe, expect, it } from "vitest";
import {
  repositoryRoot,
  resolveConfig,
} from "../../src/infrastructure/config/config.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Independent anchor: this test lives at apps/server/test/infrastructure/,
// four levels below the repository root. Asserting against it (not against
// the exported constant) catches off-by-one errors in the config module's
// own anchor.
const testAnchorRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("resolveConfig", () => {
  it("defaults: loopback host, port 8629, repo data root, info logs", () => {
    const config = resolveConfig({ env: {} });
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8629);
    expect(config.paths.dataRoot).toBe(path.join(testAnchorRoot, "data"));
    expect(config.paths.webRoot).toBe(
      path.join(testAnchorRoot, "apps/web/dist"),
    );
    expect(config.logLevel).toBe("info");
  });

  it("db defaults: sqlite dialect, loopback mysql target held in reserve", () => {
    const config = resolveConfig({ env: {} });
    expect(config.db.dialect).toBe("sqlite");
    expect(config.db.mysql).toEqual({
      host: "127.0.0.1",
      port: 3306,
      user: "toby",
      password: "",
      databasePrefix: "toby_",
    });
  });

  it("TOBY_DB_* overrides are honored", () => {
    const config = resolveConfig({
      env: {
        TOBY_DB_DIALECT: "mysql",
        TOBY_DB_MYSQL_HOST: "db.internal",
        TOBY_DB_MYSQL_PORT: "3307",
        TOBY_DB_MYSQL_USER: "tobyuser",
        TOBY_DB_MYSQL_PASSWORD: "secret",
        TOBY_DB_MYSQL_DATABASE_PREFIX: "tobydev_",
      },
    });
    expect(config.db.dialect).toBe("mysql");
    expect(config.db.mysql).toEqual({
      host: "db.internal",
      port: 3307,
      user: "tobyuser",
      password: "secret",
      databasePrefix: "tobydev_",
    });
  });

  it("invalid db dialect, mysql port and prefix are rejected", () => {
    expect(() =>
      resolveConfig({ env: { TOBY_DB_DIALECT: "postgres" } }),
    ).toThrow(/TOBY_DB_DIALECT/);
    expect(() =>
      resolveConfig({ env: { TOBY_DB_MYSQL_PORT: "not-a-port" } }),
    ).toThrow(/TOBY_DB_MYSQL_PORT/);
    expect(() =>
      resolveConfig({ env: { TOBY_DB_MYSQL_DATABASE_PREFIX: "bad prefix" } }),
    ).toThrow(/TOBY_DB_MYSQL_DATABASE_PREFIX/);
  });

  it("repositoryRoot matches the independent test anchor", () => {
    expect(repositoryRoot).toBe(testAnchorRoot);
  });

  it("TOBY_* overrides are honored, paths resolve against the repo root", () => {
    const config = resolveConfig({
      env: {
        TOBY_HOST: "localhost",
        TOBY_PORT: "9000",
        TOBY_DATA_ROOT: "./store",
        TOBY_LOG_LEVEL: "debug",
      },
    });
    expect(config.server.host).toBe("localhost");
    expect(config.server.port).toBe(9000);
    expect(config.paths.dataRoot).toBe(path.join(repositoryRoot, "store"));
    expect(config.logLevel).toBe("debug");
  });

  it("0.0.0.0 is allowed for containers, other public hosts rejected", () => {
    expect(resolveConfig({ env: { TOBY_HOST: "0.0.0.0" } }).server.host).toBe(
      "0.0.0.0",
    );
    expect(() => resolveConfig({ env: { TOBY_HOST: "10.0.0.1" } })).toThrow();
  });

  it("invalid ports are rejected", () => {
    expect(() => resolveConfig({ env: { TOBY_PORT: "abc" } })).toThrow();
    expect(() => resolveConfig({ env: { TOBY_PORT: "70000" } })).toThrow();
  });

  it("ai defaults: unconfigured openai-compatible transport", () => {
    const config = resolveConfig({ env: {} });
    expect(config.ai).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "",
      timeoutMs: 30_000,
    });
  });

  it("TOBY_AI_* overrides are honored", () => {
    const config = resolveConfig({
      env: {
        TOBY_AI_BASE_URL: "https://ai.example/v1",
        TOBY_AI_API_KEY: "secret",
        TOBY_AI_MODEL: "glm-4.7",
        TOBY_AI_TIMEOUT_MS: "60000",
      },
    });
    expect(config.ai).toEqual({
      baseUrl: "https://ai.example/v1",
      apiKey: "secret",
      model: "glm-4.7",
      timeoutMs: 60_000,
    });
  });

  it("an api key without a model, or a bad timeout, is rejected", () => {
    expect(() => resolveConfig({ env: { TOBY_AI_API_KEY: "k" } })).toThrow(
      /TOBY_AI_MODEL/,
    );
    expect(() => resolveConfig({ env: { TOBY_AI_TIMEOUT_MS: "10" } })).toThrow(
      /TOBY_AI_TIMEOUT_MS/,
    );
  });

  it("auth defaults: disabled, 7-day sessions, 5 per minute", () => {
    const config = resolveConfig({ env: {} });
    expect(config.auth).toEqual({
      enabled: false,
      passwordHash: "",
      sessionTtlMs: 168 * 3_600_000,
      rateLimitMax: 5,
      rateLimitWindowMs: 60_000,
      secureCookie: false,
    });
  });

  it("TOBY_AUTH_* overrides are honored and enable authentication", () => {
    const hash = "scrypt$16384$8$1$c2FsdA== $aGFzaA==".replace(" ", ""); // format-only
    const config = resolveConfig({
      env: {
        TOBY_AUTH_PASSWORD_HASH: hash,
        TOBY_AUTH_SESSION_TTL_HOURS: "24",
        TOBY_AUTH_RATE_LIMIT_MAX: "10",
        TOBY_AUTH_RATE_LIMIT_WINDOW_MS: "120000",
        TOBY_AUTH_SECURE_COOKIE: "true",
      },
    });
    expect(config.auth.enabled).toBe(true);
    expect(config.auth.passwordHash).toBe(hash);
    expect(config.auth.sessionTtlMs).toBe(24 * 3_600_000);
    expect(config.auth.rateLimitMax).toBe(10);
    expect(config.auth.rateLimitWindowMs).toBe(120_000);
    expect(config.auth.secureCookie).toBe(true);
  });

  it("malformed auth values are rejected", () => {
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_PASSWORD_HASH: "plaintext" } }),
    ).toThrow(/TOBY_AUTH_PASSWORD_HASH/);
    // The scrypt parameters are pinned to the generator's — anything else
    // fails at startup instead of at login time.
    expect(() =>
      resolveConfig({
        env: { TOBY_AUTH_PASSWORD_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==" },
      }),
    ).toThrow(/TOBY_AUTH_PASSWORD_HASH/);
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_SESSION_TTL_HOURS: "0" } }),
    ).toThrow(/TOBY_AUTH_SESSION_TTL_HOURS/);
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_RATE_LIMIT_MAX: "0" } }),
    ).toThrow(/TOBY_AUTH_RATE_LIMIT_MAX/);
  });

  it("boolean flags accept only true/false; trustProxy defaults off", () => {
    expect(resolveConfig({ env: {} }).trustProxy).toBe(false);
    expect(
      resolveConfig({ env: { TOBY_TRUST_PROXY: "true" } }).trustProxy,
    ).toBe(true);
    expect(
      resolveConfig({ env: { TOBY_AUTH_SECURE_COOKIE: "false" } }).auth
        .secureCookie,
    ).toBe(false);
    expect(() => resolveConfig({ env: { TOBY_TRUST_PROXY: "yes" } })).toThrow(
      /TOBY_TRUST_PROXY/,
    );
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_SECURE_COOKIE: "True" } }),
    ).toThrow(/TOBY_AUTH_SECURE_COOKIE/);
  });
});
