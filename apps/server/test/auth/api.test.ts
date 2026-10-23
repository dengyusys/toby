/**
 * Auth domain over HTTP: the contract's five scenarios (not logged in,
 * wrong password, logout, expiry, revocation), the exemption surface
 * (login endpoint + static pages), and the rate limit with recovery.
 * Auth is driven purely through env-injected config and an injected clock.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNestServer,
  type NestServer,
} from "../../src/infrastructure/http/nest-app.ts";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";
import { createLedgerModule } from "../../src/domains/ledger/ledger.module.ts";
import { createAuthModule } from "../../src/domains/auth/auth.module.ts";
import { hashPassword } from "../../src/domains/auth/password.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-auth-api-"));
const staticRoot = path.join(baseDir, "static");
const PASSWORD = "correct horse battery staple";
const PASSWORD_HASH = hashPassword(PASSWORD);

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

let app: NestServer;
let nowMs: number;
let caseCounter = 0;
const BASE_MS = Date.parse("2026-10-20T08:00:00.000Z");

async function buildApp(env: Record<string, string>): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: {
      TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`),
      ...env,
    },
  });
  const ledger = await createLedgerModule(config, { now: () => nowMs });
  const auth = createAuthModule(config, { now: () => nowMs });
  app = await createNestServer({
    webRoot: path.join(staticRoot, "web"),
    mobileWebRoot: path.join(staticRoot, "mobile"),
    domainModules: [SystemModule, ledger, auth.module],
    requestGuard: auth.requestGuard,
    trustProxy: config.trustProxy,
  });
}

function inject(
  method: string,
  url: string,
  payload?: Record<string, unknown>,
  cookie?: string,
  extraHeaders?: Record<string, string>,
) {
  const options = {
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
    ...(extraHeaders === undefined
      ? {}
      : { headers: { ...extraHeaders, ...(cookie ? { cookie } : {}) } }),
  };
  return app.inject(options);
}

function tokenFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  const match = /toby_session=([^;]+)/.exec(String(raw));
  if (!match) {
    throw new Error("no session cookie in response");
  }
  return match[1]!;
}

async function login(password: string, cookie?: string) {
  return inject("POST", "/api/auth/login", { password }, cookie);
}

afterEach(async () => {
  await app.close();
});

describe("auth disabled (no password hash configured)", () => {
  beforeEach(async () => {
    await buildApp({});
  });

  it("session reports enabled false and login is rejected", async () => {
    const session = await inject("GET", "/api/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ enabled: false, authenticated: false });

    const loginResponse = await login(PASSWORD);
    expect(loginResponse.statusCode).toBe(400);
    expect(loginResponse.json().error.code).toBe("AUTH_DISABLED");
  });

  it("business endpoints stay open — local dev behavior", async () => {
    const months = await inject("GET", "/api/ledger/months");
    expect(months.statusCode).toBe(200);
    expect(months.json()).toEqual({ months: [] });
  });
});

describe("auth enabled", () => {
  beforeEach(async () => {
    await buildApp({ TOBY_AUTH_PASSWORD_HASH: PASSWORD_HASH });
  });

  it("not logged in: business endpoints answer 401 AUTH_REQUIRED", async () => {
    for (const url of [
      "/api/ledger/months",
      "/api/ledger/transactions?month=2026-10",
      "/api/system/health",
    ]) {
      const response = await inject("GET", url);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("AUTH_REQUIRED");
    }
    // The auth endpoints themselves stay reachable: logout is idempotent
    // and the session query feeds the login page.
    const logout = await inject("POST", "/api/auth/logout");
    expect(logout.statusCode).toBe(200);
    const session = await inject("GET", "/api/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json().authenticated).toBe(false);
  });

  it("static pages stay exempt (404 for missing builds, never 401)", async () => {
    const page = await inject("GET", "/");
    expect(page.statusCode).toBe(404);
    expect(page.json().error.code).toBe("PAGE_NOT_FOUND");
  });

  it("wrong password is 401; the right one sets an HttpOnly cookie", async () => {
    const wrong = await login("nope");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_CREDENTIALS");

    const right = await login(PASSWORD);
    expect(right.statusCode).toBe(200);
    expect(right.json()).toEqual({ status: "ok" });
    const setCookie = String(right.headers["set-cookie"]);
    expect(setCookie).toContain("toby_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    // Secure is opt-in via TOBY_AUTH_SECURE_COOKIE (covered below).
    expect(setCookie).not.toContain("Secure");
  });

  it("TOBY_AUTH_SECURE_COOKIE=true adds the Secure flag to the session cookie", async () => {
    // One assertion through three layers: config parse → module assembly →
    // controller cookie flags. Release the beforeEach assembly first —
    // an open sqlite file cannot be unlinked on Windows.
    await app.close();
    await buildApp({
      TOBY_AUTH_PASSWORD_HASH: PASSWORD_HASH,
      TOBY_AUTH_SECURE_COOKIE: "true",
    });
    const response = await login(PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["set-cookie"])).toContain("; Secure");
  });

  it("a valid session opens the API and reports itself", async () => {
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session=${token}`;

    const months = await inject("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(200);
    const health = await inject("GET", "/api/system/health", undefined, cookie);
    expect(health.statusCode).toBe(200);

    const session = await inject("GET", "/api/auth/session", undefined, cookie);
    expect(session.statusCode).toBe(200);
    const body = session.json() as {
      enabled: boolean;
      authenticated: boolean;
      expires_at?: string;
    };
    expect(body.enabled).toBe(true);
    expect(body.authenticated).toBe(true);
    // TTL is 7 days from the fixed test clock, returned as a UTC ISO string.
    expect(body.expires_at).toBe(
      new Date(BASE_MS + 7 * 24 * 3_600_000).toISOString(),
    );
  });

  it("logout revokes the session; repeating logout stays 200", async () => {
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session=${token}`;

    const logout = await inject("POST", "/api/auth/logout", undefined, cookie);
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

    // The old token is revoked even if the client kept the cookie.
    const months = await inject("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(401);

    const again = await inject("POST", "/api/auth/logout", undefined, cookie);
    expect(again.statusCode).toBe(200);
  });

  it("sessions expire with the configured TTL", async () => {
    const token = tokenFrom(await login(PASSWORD));
    nowMs += 7 * 24 * 3_600_000 + 1; // default TTL is 7 days
    const months = await inject(
      "GET",
      "/api/ledger/months",
      undefined,
      `toby_session=${token}`,
    );
    expect(months.statusCode).toBe(401);
  });

  it("login attempts are rate limited per IP and recover after the window", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await login("nope");
      expect(wrong.statusCode).toBe(401);
    }
    // Even the correct password is blocked inside the window.
    const blocked = await login(PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    nowMs += 61_000; // window rolls over
    const recovered = await login(PASSWORD);
    expect(recovered.statusCode).toBe(200);
  });

  it("behind a trusted proxy, rate limiting buckets by forwarded client IP", async () => {
    // The default app does NOT trust the header: every caller shares the
    // proxy's socket address. TOBY_TRUST_PROXY restores per-client buckets.
    await app.close();
    await buildApp({
      TOBY_AUTH_PASSWORD_HASH: PASSWORD_HASH,
      TOBY_TRUST_PROXY: "true",
    });
    const attemptFrom = (ip: string) =>
      inject("POST", "/api/auth/login", { password: "nope" }, undefined, {
        "x-forwarded-for": ip,
      });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await attemptFrom("203.0.113.9")).statusCode).toBe(401);
    }
    expect((await attemptFrom("203.0.113.9")).statusCode).toBe(429);
    // A different real client keeps its own bucket: the lockout above does
    // not bleed into everyone behind the proxy.
    expect((await attemptFrom("198.51.100.7")).statusCode).toBe(401);
  });
});

describe("auth configured with a malformed hash", () => {
  it("startup fails fast with a clear message", async () => {
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_PASSWORD_HASH: "not-scrypt" } }),
    ).toThrow(/TOBY_AUTH_PASSWORD_HASH/);
  });
});
