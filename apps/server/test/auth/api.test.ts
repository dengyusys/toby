/**
 * Auth domain over HTTP: first-run registration (the startup window, the
 * one-time rule), the contract's five scenarios (not logged in, wrong
 * password, logout, expiry, revocation) and the exemption surface (auth
 * endpoints + static pages). Everything runs over the production assembly
 * with an injected clock.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { productionDomains } from "../../src/composition-root.ts";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import {
  REGISTRATION_WINDOW_MS,
  TOKEN_LAST_USED_THROTTLE_MS,
} from "../../src/domains/auth/service.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-auth-api-"));
const PASSWORD = "correct horse battery staple";

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
  method: "GET" | "POST" | "PUT",
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

function register(password: string) {
  return send("POST", "/api/auth/register", { password });
}

async function login(password: string, cookie?: string) {
  return send("POST", "/api/auth/login", { password }, cookie);
}

/** Any request, with whatever headers — a cookie, an Authorization, both. */
function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: {
    payload?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
) {
  return app.inject({
    method,
    url,
    ...(options.payload !== undefined ? { payload: options.payload } : {}),
    headers: options.headers ?? {},
  });
}

interface TokenView {
  id: string;
  name: string;
  scopes: string[];
  last_four: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/** Creates a token over the browser session: a 200, with the secret once. */
async function createToken(
  cookie: string,
  body: Record<string, unknown> = { name: "probe", scopes: ["write"] },
): Promise<{ token: TokenView; secret: string }> {
  const response = await call("POST", "/api/auth/tokens", {
    payload: body,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { token: TokenView; secret: string };
}

afterEach(async () => {
  await app.close();
});

describe("not registered (a fresh auth database)", () => {
  beforeEach(async () => {
    await buildApp({});
  });

  it("the session reports unregistered and nothing opens without a password", async () => {
    const session = await send("GET", "/api/auth/session");
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ state: "unregistered" });

    // Before a password exists, no password can be the right one.
    const loginResponse = await login(PASSWORD);
    expect(loginResponse.statusCode).toBe(401);
    expect(loginResponse.json().errorCode).toBe("INVALID_CREDENTIALS");

    for (const url of ["/api/ledger/months", "/api/system/info"]) {
      const response = await send("GET", url);
      expect(response.statusCode).toBe(401);
      expect(response.json().errorCode).toBe("AUTH_REQUIRED");
    }
  });

  it("registration sets the password once and starts a session", async () => {
    const response = await register(PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("toby_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");

    const cookie = `toby_session=${tokenFrom(response)}`;
    const months = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(months.statusCode).toBe(200);

    // One owner, one password: the page is gone the moment it succeeds.
    const again = await register("another passphrase");
    expect(again.statusCode).toBe(403);
    expect(again.json().errorCode).toBe("ALREADY_REGISTERED");

    const session = await send("GET", "/api/auth/session");
    expect(session.json()).toEqual({ state: "unauthenticated" });
    const right = await login(PASSWORD);
    expect(right.statusCode).toBe(200);
    const wrong = await login("another passphrase");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("registration closes with the startup window; a restart reopens it", async () => {
    nowMs += REGISTRATION_WINDOW_MS;
    const response = await register(PASSWORD);
    expect(response.statusCode).toBe(403);
    expect(response.json().errorCode).toBe("REGISTRATION_CLOSED");
    // Nothing was stored: the deployment is still unregistered.
    const session = await send("GET", "/api/auth/session");
    expect(session.json()).toEqual({ state: "unregistered" });

    // A restart is a new startup, so the window starts over.
    await app.close();
    await buildApp({});
    const reopened = await register(PASSWORD);
    expect(reopened.statusCode).toBe(200);
  });

  it("the last moment inside the window still registers", async () => {
    nowMs += REGISTRATION_WINDOW_MS - 1;
    const response = await register(PASSWORD);
    expect(response.statusCode).toBe(200);
  });

  it("any non-empty password registers, however short", async () => {
    const response = await register("1234");
    expect(response.statusCode).toBe(200);

    const cookie = `toby_session=${tokenFrom(response)}`;
    const logout = await send("POST", "/api/auth/logout", undefined, cookie);
    expect(logout.statusCode).toBe(200);
    expect((await login("1234")).statusCode).toBe(200);
    expect((await login("12345")).statusCode).toBe(401);
  });

  it("an empty password, an unknown field, or a missing body is a 400", async () => {
    for (const body of [
      { password: "" },
      { password: PASSWORD, extra: true },
    ]) {
      const response = await send("POST", "/api/auth/register", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
    const noBody = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "application/json" },
    });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().errorCode).toBe("BAD_REQUEST");

    // A rejected registration stores nothing.
    const session = await send("GET", "/api/auth/session");
    expect(session.json()).toEqual({ state: "unregistered" });
  });
});

describe("registered", () => {
  beforeEach(async () => {
    await buildApp({});
    const response = await register(PASSWORD);
    expect(response.statusCode).toBe(200);
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
    expect(session.json()).toEqual({ state: "unauthenticated" });
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
    await buildApp({ TOBY_AUTH_SECURE_COOKIE: "true" });
    expect((await register(PASSWORD)).statusCode).toBe(200);
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
      state: string;
      expires_at?: string;
    };
    expect(body.state).toBe("authenticated");
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

  it("changing the password needs the current one and ends every session", async () => {
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session=${token}`;
    const NEXT = "another passphrase";

    const wrong = await send(
      "PUT",
      "/api/auth/password",
      { current_password: "nope", new_password: NEXT },
      cookie,
    );
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().errorCode).toBe("INVALID_CREDENTIALS");
    // A failed attempt changes nothing: the old password and the session
    // both still work.
    expect((await login(PASSWORD)).statusCode).toBe(200);
    const untouched = await send(
      "GET",
      "/api/ledger/months",
      undefined,
      cookie,
    );
    expect(untouched.statusCode).toBe(200);

    const changed = await send(
      "PUT",
      "/api/auth/password",
      { current_password: PASSWORD, new_password: NEXT },
      cookie,
    );
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ status: "ok" });
    expect(String(changed.headers["set-cookie"])).toContain("Max-Age=0");

    // The session that made the change is gone with all the others, and
    // only the new password opens a session again.
    const revoked = await send("GET", "/api/ledger/months", undefined, cookie);
    expect(revoked.statusCode).toBe(401);
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login(NEXT)).statusCode).toBe(200);
  });

  it("the password can change to any non-empty one, however short", async () => {
    const cookie = `toby_session=${tokenFrom(await login(PASSWORD))}`;
    const changed = await send(
      "PUT",
      "/api/auth/password",
      { current_password: PASSWORD, new_password: "ab" },
      cookie,
    );
    expect(changed.statusCode).toBe(200);
    expect((await login("ab")).statusCode).toBe(200);
  });

  it("an empty new password, one equal to the old, or an unknown field is a 400", async () => {
    const cookie = `toby_session=${tokenFrom(await login(PASSWORD))}`;
    for (const body of [
      { current_password: PASSWORD, new_password: "" },
      { current_password: PASSWORD, new_password: PASSWORD },
      {
        current_password: PASSWORD,
        new_password: "another passphrase",
        extra: true,
      },
    ]) {
      const response = await send("PUT", "/api/auth/password", body, cookie);
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
    expect((await login(PASSWORD)).statusCode).toBe(200);
    const untouched = await send(
      "GET",
      "/api/ledger/months",
      undefined,
      cookie,
    );
    expect(untouched.statusCode).toBe(200);
  });

  it("changing the password requires a session", async () => {
    const response = await send("PUT", "/api/auth/password", {
      current_password: PASSWORD,
      new_password: "another passphrase",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().errorCode).toBe("AUTH_REQUIRED");
  });

  it("a quoted session cookie: the session answers, the guard does not", async () => {
    // The first server's asymmetry, kept on purpose: the session endpoint
    // parsed the cookie value (RFC 6265 unquoting), while its guard matched
    // the raw header — a quoted token is not a token the server ever set.
    const token = tokenFrom(await login(PASSWORD));
    const cookie = `toby_session="${token}"`;
    const session = await send("GET", "/api/auth/session", undefined, cookie);
    expect(session.statusCode).toBe(200);
    expect(session.json().state).toBe("authenticated");
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

describe("access tokens", () => {
  let cookie: string;
  const ENTRY = {
    date: "2026-10-20",
    type: "expense",
    category: "餐饮",
    amount: "25",
    note: "token probe",
  };

  beforeEach(async () => {
    await buildApp({});
    cookie = `toby_session=${tokenFrom(await register(PASSWORD))}`;
  });

  it("token management is the browser session's business", async () => {
    for (const method of ["GET", "POST"] as const) {
      const anonymous = await call(method, "/api/auth/tokens");
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json().errorCode).toBe("AUTH_REQUIRED");
    }
    // Even a write token never manages the owner's tokens.
    const { secret } = await createToken(cookie);
    const viaToken = await call("GET", "/api/auth/tokens", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(viaToken.statusCode).toBe(403);
    expect(viaToken.json().errorCode).toBe("SESSION_REQUIRED");
    const minted = await call("POST", "/api/auth/tokens", {
      payload: { name: "self-made", scopes: ["read"] },
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(minted.statusCode).toBe(403);
    expect(minted.json().errorCode).toBe("SESSION_REQUIRED");
  });

  it("a write token calls the API like a session does", async () => {
    const { token, secret } = await createToken(cookie, {
      name: "my page",
      scopes: ["write"],
    });
    expect(token).toMatchObject({
      name: "my page",
      scopes: ["write"],
      last_four: secret.slice(-4),
      last_used_at: null,
      expires_at: null,
    });
    const auth = { authorization: `Bearer ${secret}` };

    const months = await call("GET", "/api/ledger/months", { headers: auth });
    expect(months.statusCode).toBe(200);
    const written = await call("POST", "/api/ledger/entries", {
      payload: { entry: ENTRY },
      headers: auth,
    });
    expect(written.statusCode).toBe(200);
  });

  it("a read token looks but never changes", async () => {
    const { secret } = await createToken(cookie, {
      name: "dashboard",
      scopes: ["read"],
    });
    const auth = { authorization: `Bearer ${secret}` };

    for (const url of [
      "/api/ledger/months",
      "/api/chat/sessions",
      "/api/system/info",
    ]) {
      const looked = await call("GET", url, { headers: auth });
      expect(looked.statusCode).toBe(200);
    }
    for (const [method, url, payload] of [
      ["POST", "/api/ledger/entries", { entry: ENTRY }],
      ["POST", "/api/chat/messages", { text: "hello" }],
      ["POST", "/api/memory/off-record", { on: true }],
    ] as const) {
      const refused = await call(method, url, { payload, headers: auth });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().errorCode).toBe("INSUFFICIENT_SCOPE");
    }
  });

  it("session-only routes refuse every token, write included", async () => {
    const { secret } = await createToken(cookie, {
      name: "write",
      scopes: ["write"],
    });
    const auth = { authorization: `Bearer ${secret}` };

    for (const [method, url, payload] of [
      ["GET", "/api/settings/ai"],
      ["PUT", "/api/settings/ai", { model: null }],
      ["POST", "/api/settings/ai/test", {}],
      ["GET", "/api/settings/ai/catalog"],
      ["POST", "/api/memory/reset"],
      [
        "PUT",
        "/api/auth/password",
        { current_password: PASSWORD, new_password: "another passphrase" },
      ],
      ["GET", "/api/auth/tokens"],
      ["DELETE", "/api/auth/tokens/some-id"],
    ] as const) {
      const refused = await call(method, url, { payload, headers: auth });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().errorCode).toBe("SESSION_REQUIRED");
    }
    // Nothing gave: the password still works and the session is intact.
    expect((await login(PASSWORD)).statusCode).toBe(200);
    expect(
      (await call("GET", "/api/auth/tokens", { headers: { cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it("an unknown, revoked, or expired token answers 401 INVALID_TOKEN", async () => {
    const unknown = await call("GET", "/api/ledger/months", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().errorCode).toBe("INVALID_TOKEN");

    const revoked = await createToken(cookie);
    const revoke = await call(
      "DELETE",
      `/api/auth/tokens/${revoked.token.id}`,
      {
        headers: { cookie },
      },
    );
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toMatchObject({
      id: revoked.token.id,
      action: "revoked",
    });
    const afterRevoke = await call("GET", "/api/ledger/months", {
      headers: { authorization: `Bearer ${revoked.secret}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(afterRevoke.json().errorCode).toBe("INVALID_TOKEN");
    // Revoking twice is harmless; an id that never existed is a 404.
    expect(
      (
        await call("DELETE", `/api/auth/tokens/${revoked.token.id}`, {
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const missing = await call("DELETE", "/api/auth/tokens/no-such-id", {
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("TOKEN_NOT_FOUND");

    const expiring = await createToken(cookie, {
      name: "short-lived",
      scopes: ["read"],
      expires_at: new Date(nowMs + 60_000).toISOString(),
    });
    expect(expiring.token.expires_at).toBe(
      new Date(nowMs + 60_000).toISOString(),
    );
    nowMs += 60_000;
    const expired = await call("GET", "/api/ledger/months", {
      headers: { authorization: `Bearer ${expiring.secret}` },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().errorCode).toBe("INVALID_TOKEN");
  });

  it("a presented token decides the request, whatever cookies sit beside it", async () => {
    const { secret } = await createToken(cookie, {
      name: "read",
      scopes: ["read"],
    });
    // An invalid token is still invalid beside a valid session.
    const bad = await call("GET", "/api/ledger/months", {
      headers: { authorization: "Bearer nope", cookie },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().errorCode).toBe("INVALID_TOKEN");
    // A read token is still read-only beside a valid session.
    const limited = await call("POST", "/api/ledger/entries", {
      payload: { entry: ENTRY },
      headers: { authorization: `Bearer ${secret}`, cookie },
    });
    expect(limited.statusCode).toBe(403);
    expect(limited.json().errorCode).toBe("INSUFFICIENT_SCOPE");
    // A non-Bearer Authorization header is not ours: the cookie decides.
    const basic = await call("GET", "/api/ledger/months", {
      headers: { authorization: "Basic abc", cookie },
    });
    expect(basic.statusCode).toBe(200);
  });

  it("the list shows the tail and the last use, never the secret", async () => {
    const { token, secret } = await createToken(cookie, {
      name: "script",
      scopes: ["read"],
    });
    const list = async () =>
      (
        (
          await call("GET", "/api/auth/tokens", { headers: { cookie } })
        ).json() as { tokens: TokenView[] }
      ).tokens;

    expect(await list()).toEqual([token]);
    const auth = { authorization: `Bearer ${secret}` };

    expect(
      (await call("GET", "/api/ledger/months", { headers: auth })).statusCode,
    ).toBe(200);
    const firstUse = new Date(nowMs).toISOString();
    expect((await list())[0]?.last_used_at).toBe(firstUse);

    // A second use inside the throttle window leaves the stamp alone.
    nowMs += 60_000;
    await call("GET", "/api/ledger/months", { headers: auth });
    expect((await list())[0]?.last_used_at).toBe(firstUse);

    nowMs += TOKEN_LAST_USED_THROTTLE_MS;
    await call("GET", "/api/ledger/months", { headers: auth });
    expect((await list())[0]?.last_used_at).toBe(new Date(nowMs).toISOString());
  });

  it("creation refuses anything but a name, one tier, and a future expiry", async () => {
    for (const body of [
      { name: "", scopes: ["read"] },
      { name: "x".repeat(65), scopes: ["read"] },
      { name: "ok", scopes: [] },
      { name: "ok", scopes: ["read", "write"] },
      { name: "ok", scopes: ["admin"] },
      { name: "ok", scopes: "read" },
      { name: "ok", scopes: ["read"], extra: true },
      { name: "ok", scopes: ["read"], expires_at: "yesterday" },
      {
        name: "ok",
        scopes: ["read"],
        expires_at: new Date(nowMs).toISOString(),
      },
    ]) {
      const refused = await call("POST", "/api/auth/tokens", {
        payload: body,
        headers: { cookie },
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().errorCode).toBe("BAD_REQUEST");
    }
    const listed = await call("GET", "/api/auth/tokens", {
      headers: { cookie },
    });
    expect(listed.json()).toEqual({ tokens: [] });

    // A valid expiry is stored in canonical UTC.
    const ok = await createToken(cookie, {
      name: "ok",
      scopes: ["read"],
      expires_at: "2027-01-01T08:00:00+08:00",
    });
    expect(ok.token.expires_at).toBe("2027-01-01T00:00:00.000Z");
  });
});
