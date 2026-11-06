/**
 * Auth domain over HTTP: the contract's five scenarios (not logged in,
 * wrong password, logout, expiry, revocation) plus the exemption surface
 * (login endpoint + static pages). Auth is driven purely through
 * env-injected config and an injected clock, over the production assembly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { productionDomains } from "../../src/composition-root.ts";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { hashPassword } from "../../src/domains/auth/password.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-auth-api-"));
const PASSWORD = "correct horse battery staple";
const PASSWORD_HASH = hashPassword(PASSWORD);

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

let app: FastifyInstance;
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
  app = await createTestApp({
    config,
    domains: productionDomains({ config, clock: () => nowMs }),
  });
}

function send(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  cookie?: string,
) {
  return app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload } : {}),
    headers: cookie !== undefined ? { cookie } : {},
  });
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
  return send("POST", "/api/auth/login", { password }, cookie);
}

afterEach(async () => {
  await app.close();
});

describe("auth disabled (no password hash configured)", () => {
  beforeEach(async () => {
    await buildApp({});
  });

  it("session reports enabled false and login is rejected", async () => {
    const session = await send("GET", "/api/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ enabled: false, authenticated: false });

    const loginResponse = await login(PASSWORD);
    expect(loginResponse.statusCode).toBe(400);
    expect(loginResponse.json().errorCode).toBe("AUTH_DISABLED");
  });

  it("business endpoints stay open — local dev behavior", async () => {
    const months = await send("GET", "/api/ledger/months");
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
      "/api/system/info",
    ]) {
      const response = await send("GET", url);
      expect(response.statusCode).toBe(401);
      expect(response.json().errorCode).toBe("AUTH_REQUIRED");
    }
    // The auth endpoints themselves stay reachable: logout is idempotent
    // and the session query feeds the login page.
    const logout = await send("POST", "/api/auth/logout");
    expect(logout.statusCode).toBe(200);
    const session = await send("GET", "/api/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json().authenticated).toBe(false);
  });

  it("health stays public: the Docker healthcheck must not need a session", async () => {
    const health = await send("GET", "/api/system/health");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok" });
  });

  it("percent-encoded paths cannot dodge the session guard", async () => {
    // The router matches /%61pi/... and /api/%6Cedger/... onto /api/...
    // routes after decoding, so the guard runs on the matched route and
    // the encoded variants must answer 401 all the same.
    for (const url of ["/%61pi/ledger/months", "/api/%6Cedger/months"]) {
      const response = await send("GET", url);
      expect(response.statusCode).toBe(401);
      expect(response.json().errorCode).toBe("AUTH_REQUIRED");
    }
  });

  it("a trailing slash on an /api route changes nothing", async () => {
    // The router strips one trailing slash before matching, as it always
    // has; the guarded route stays guarded, the public one public.
    const guarded = await send("GET", "/api/ledger/months/");
    expect(guarded.statusCode).toBe(401);
    expect(guarded.json().errorCode).toBe("AUTH_REQUIRED");
    const health = await send("GET", "/api/system/health/");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
  });

  it("static pages stay exempt (404 for missing builds, never 401)", async () => {
    const page = await send("GET", "/");
    expect(page.statusCode).toBe(404);
    expect(page.json().errorCode).toBe("PAGE_NOT_FOUND");
  });

  it("a body that is not shaped like a login is a 400, not a wrong password", async () => {
    for (const body of [{ password: 123 }, { password: { nested: true } }]) {
      const response = await send("POST", "/api/auth/login", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
    // A missing field stays a 401: an empty form is a wrong password.
    const empty = await send("POST", "/api/auth/login", {});
    expect(empty.statusCode).toBe(401);
    expect(empty.json().errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("a null body, no body at all, or an unparsed type is a 400", async () => {
    const requests = [
      { headers: { "content-type": "application/json" }, payload: "null" },
      // A content type but no body declared: nothing to log in with.
      { headers: { "content-type": "application/json" } },
      // No content type at all: nothing to parse, nothing to log in.
      {},
      // A type without a parser is dropped, so the envelope check answers
      // — including one that is not even type/subtype.
      {
        headers: { "content-type": "application/vnd.api+json" },
        payload: JSON.stringify({ password: PASSWORD }),
      },
      {
        headers: { "content-type": "text+plain" },
        payload: JSON.stringify({ password: PASSWORD }),
      },
    ];
    for (const request of requests) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        ...request,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
  });

  it("a URL-encoded login form works like the JSON one", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["set-cookie"])).toContain("toby_session=");
  });

  it("wrong password is 401; the right one sets an HttpOnly cookie", async () => {
    const wrong = await login("nope");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().errorCode).toBe("INVALID_CREDENTIALS");

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
    // One assertion through three layers: config parse → domain assembly →
    // route cookie flags. Release the beforeEach assembly first — an open
    // sqlite file cannot be unlinked on Windows.
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

    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(200);
    const health = await send("GET", "/api/system/health", undefined, cookie);
    expect(health.statusCode).toBe(200);

    const session = await send("GET", "/api/auth/session", undefined, cookie);
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

    const logout = await send("POST", "/api/auth/logout", undefined, cookie);
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

    // The old token is revoked even if the client kept the cookie.
    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(401);

    const again = await send("POST", "/api/auth/logout", undefined, cookie);
    expect(again.statusCode).toBe(200);
  });

  it("sessions expire with the configured TTL", async () => {
    const token = tokenFrom(await login(PASSWORD));
    nowMs += 7 * 24 * 3_600_000 + 1; // default TTL is 7 days
    const months = await send(
      "GET",
      "/api/ledger/months",
      undefined,
      `toby_session=${token}`,
    );
    expect(months.statusCode).toBe(401);
  });

  it("a quoted session cookie: the session answers, the guard does not", async () => {
    // The first server's asymmetry, kept on purpose: the session endpoint
    // parsed the cookie value (RFC 6265 unquoting), while its guard matched
    // the raw header — a quoted token is not a token the server ever set.
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session="${token}"`;
    const session = await send("GET", "/api/auth/session", undefined, cookie);
    expect(session.statusCode).toBe(200);
    expect(session.json().authenticated).toBe(true);
    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(401);
    expect(months.json().errorCode).toBe("AUTH_REQUIRED");
  });

  it("HEAD requests follow the same guard as their GET", async () => {
    const guarded = await app.inject({
      method: "HEAD",
      url: "/api/ledger/months",
    });
    expect(guarded.statusCode).toBe(401);
    const health = await app.inject({
      method: "HEAD",
      url: "/api/system/health",
    });
    expect(health.statusCode).toBe(200);
  });

  it("an /api route is guarded unless it opts out with config.public", async () => {
    // Default-secure: a route that forgets to declare itself is protected,
    // never silently open.
    await app.close();
    caseCounter += 1;
    const config = resolveConfig({
      env: {
        TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`),
        TOBY_AUTH_PASSWORD_HASH: PASSWORD_HASH,
      },
    });
    app = await createTestApp({
      config,
      domains: [
        ...productionDomains({ config, clock: () => nowMs }),
        (instance) =>
          instance.register(async (probe) => {
            probe.get("/api/probe/default", () => ({ ok: true }));
            probe.get("/api/probe/open", { config: { public: true } }, () => ({
              ok: true,
            }));
          }),
      ],
    });
    const guarded = await send("GET", "/api/probe/default");
    expect(guarded.statusCode).toBe(401);
    expect(guarded.json().errorCode).toBe("AUTH_REQUIRED");
    const open = await send("GET", "/api/probe/open");
    expect(open.statusCode).toBe(200);
  });
});

describe("auth configured with a malformed hash", () => {
  it("startup fails fast with a clear message", async () => {
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_PASSWORD_HASH: "not-scrypt" } }),
    ).toThrow(/TOBY_AUTH_PASSWORD_HASH/);
  });
});
