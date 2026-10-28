/**
 * Auth domain over HTTP: the contract's five scenarios (not logged in,
 * wrong password, logout, expiry, revocation) plus the exemption surface
 * (login endpoint + static pages). Auth is driven purely through
 * env-injected config and an injected clock.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";
import { LedgerModule } from "../../src/domains/ledger/ledger.module.ts";
import { AuthModule } from "../../src/domains/auth/auth.module.ts";
import { hashPassword } from "../../src/domains/auth/password.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-auth-api-"));
const PASSWORD = "correct horse battery staple";
const PASSWORD_HASH = hashPassword(PASSWORD);

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

let app: NestNodeApplication;
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
    modules: [SystemModule, LedgerModule, AuthModule],
    clock: () => nowMs,
  });
}

function send(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  cookie?: string,
  extraHeaders?: Record<string, string>,
) {
  const agent = request(app.getHttpServer());
  const call = method === "GET" ? agent.get(url) : agent.post(url);
  if (cookie !== undefined) {
    call.set("cookie", cookie);
  }
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    call.set(name, value);
  }
  if (payload !== undefined) {
    call.send(payload);
  }
  return call;
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
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ enabled: false, authenticated: false });

    const loginResponse = await login(PASSWORD);
    expect(loginResponse.status).toBe(400);
    expect(loginResponse.body.errorCode).toBe("AUTH_DISABLED");
  });

  it("business endpoints stay open — local dev behavior", async () => {
    const months = await send("GET", "/api/ledger/months");
    expect(months.status).toBe(200);
    expect(months.body).toEqual({ months: [] });
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
      expect(response.status).toBe(401);
      expect(response.body.errorCode).toBe("AUTH_REQUIRED");
    }
    // The auth endpoints themselves stay reachable: logout is idempotent
    // and the session query feeds the login page.
    const logout = await send("POST", "/api/auth/logout");
    expect(logout.status).toBe(200);
    const session = await send("GET", "/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(false);
  });

  it("health stays public: the Docker healthcheck must not need a session", async () => {
    const health = await send("GET", "/api/system/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok" });
  });

  it("percent-encoded paths cannot dodge the session guard", async () => {
    // The router matches /%61pi/... and /api/%6Cedger/... onto /api/...
    // routes after decoding; the guard's exemption decision comes from
    // route metadata, so the encoded variants must answer 401 all the same.
    for (const url of ["/%61pi/ledger/months", "/api/%6Cedger/months"]) {
      const response = await send("GET", url);
      expect(response.status).toBe(401);
      expect(response.body.errorCode).toBe("AUTH_REQUIRED");
    }
  });

  it("static pages stay exempt (404 for missing builds, never 401)", async () => {
    const page = await send("GET", "/");
    expect(page.status).toBe(404);
    expect(page.body.errorCode).toBe("PAGE_NOT_FOUND");
  });

  it("a body that is not shaped like a login is a 400, not a wrong password", async () => {
    for (const body of [{ password: 123 }, { password: { nested: true } }]) {
      const response = await send("POST", "/api/auth/login", body);
      expect(response.status).toBe(400);
      expect(response.body.errorCode).toBe("BAD_REQUEST");
    }
    // A missing field stays a 401: an empty form is a wrong password.
    const empty = await send("POST", "/api/auth/login", {});
    expect(empty.status).toBe(401);
    expect(empty.body.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("wrong password is 401; the right one sets an HttpOnly cookie", async () => {
    const wrong = await login("nope");
    expect(wrong.status).toBe(401);
    expect(wrong.body.errorCode).toBe("INVALID_CREDENTIALS");

    const right = await login(PASSWORD);
    expect(right.status).toBe(200);
    expect(right.body).toEqual({ status: "ok" });
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
    expect(response.status).toBe(200);
    expect(String(response.headers["set-cookie"])).toContain("; Secure");
  });

  it("a valid session opens the API and reports itself", async () => {
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session=${token}`;

    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.status).toBe(200);
    const health = await send("GET", "/api/system/health", undefined, cookie);
    expect(health.status).toBe(200);

    const session = await send("GET", "/api/auth/session", undefined, cookie);
    expect(session.status).toBe(200);
    const body = session.body as {
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
    expect(logout.status).toBe(200);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");

    // The old token is revoked even if the client kept the cookie.
    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.status).toBe(401);

    const again = await send("POST", "/api/auth/logout", undefined, cookie);
    expect(again.status).toBe(200);
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
    expect(months.status).toBe(401);
  });
});

describe("auth configured with a malformed hash", () => {
  it("startup fails fast with a clear message", async () => {
    expect(() =>
      resolveConfig({ env: { TOBY_AUTH_PASSWORD_HASH: "not-scrypt" } }),
    ).toThrow(/TOBY_AUTH_PASSWORD_HASH/);
  });
});
