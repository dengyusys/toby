/**
 * Root HTTP integration tests: spawn the real server process and exercise it
 * over actual sockets — the contract the web apps and deployments rely on.
 * SPA serving is only asserted when a web build exists (CI never builds one).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../apps/server/src/domains/auth/password.ts";

// Repository root from this file's location — never from cwd.
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(repositoryRoot, "apps/server/dist/main.js");
const webIndex = path.join(repositoryRoot, "apps/web/dist/index.html");
const mobileIndex = path.join(
  repositoryRoot,
  "apps/web-mobile/dist/index.html",
);

/** Reserve an ephemeral port: listen on port 0, read it back, release it. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const netServer = createNetServer();
    netServer.on("error", reject);
    netServer.listen(0, "127.0.0.1", () => {
      const address = netServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not reserve a port"));
        return;
      }
      const { port } = address as AddressInfo;
      netServer.close(() => resolve(port));
    });
  });
}

// Temporary data root only — production data/ is never touched.
const tempDataRoot = mkdtempSync(path.join(tmpdir(), "toby-integration-"));

let baseUrl: string;
let serverProcess: ReturnType<typeof spawn>;
let stderrBuffer = "";

beforeAll(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      TOBY_HOST: "127.0.0.1",
      TOBY_PORT: String(port),
      TOBY_DATA_ROOT: tempDataRoot,
      TOBY_LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  serverProcess.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `server exited early (code ${serverProcess.exitCode}):\n${stderrBuffer}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`server not healthy within 20s:\n${stderrBuffer}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/system/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        break;
      }
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}, 30_000);

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    // Wait for the process to actually exit: on Windows the killed child
    // keeps its database file handles briefly, and deleting the temp data
    // root before then fails with EBUSY. Hard kill is the 5s backstop for a
    // child that ignores the first signal.
    await new Promise<void>((resolve) => {
      serverProcess.once("exit", () => resolve());
      serverProcess.kill();
      setTimeout(() => {
        serverProcess.kill("SIGKILL");
        resolve();
      }, 5_000).unref();
    });
  }
  rmSync(tempDataRoot, { recursive: true, force: true });
});

describe("http contract (api)", () => {
  it("health returns ok with no-store json", async () => {
    const response = await fetch(`${baseUrl}/api/system/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("info exposes name, version, node, started_at, uptime", async () => {
    const response = await fetch(`${baseUrl}/api/system/info`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      name: string;
      version: string;
      node: string;
      started_at: string;
      uptime_seconds: number;
    };
    expect(body.name).toBe("toby");
    expect(typeof body.version).toBe("string");
    expect(body.node).toBe(process.versions.node);
    expect(!Number.isNaN(Date.parse(body.started_at))).toBe(true);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("unknown paths get the PAGE_NOT_FOUND envelope", async () => {
    const response = await fetch(`${baseUrl}/api/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PAGE_NOT_FOUND", message: "page not found" },
    });
  });

  it("method mismatch is discriminated as 405", async () => {
    const response = await fetch(`${baseUrl}/api/system/health`, {
      method: "POST",
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" },
    });
  });
});

describe("http contract (ledger flow)", () => {
  it("records a transaction end to end through the proposal pipeline", async () => {
    const created = await fetch(`${baseUrl}/api/ledger/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entry: {
          date: "2026-10-20",
          type: "expense",
          category: "餐饮",
          account: "现金",
          amount: "25",
          note: "integration probe",
        },
      }),
    });
    expect(created.status).toBe(200);
    const proposal = (await created.json()) as {
      status: string;
      proposal_id: string;
      entries: { amount: number }[];
    };
    expect(proposal.status).toBe("pending");
    expect(proposal.entries[0]!.amount).toBe(2500);

    const commit = await fetch(
      `${baseUrl}/api/ledger/proposals/${proposal.proposal_id}/commit`,
      { method: "POST" },
    );
    expect(commit.status).toBe(200);
    const committed = (await commit.json()) as { written: number };
    expect(committed.written).toBe(1);

    const months = await fetch(`${baseUrl}/api/ledger/months`);
    expect(await months.json()).toEqual({ months: ["2026-10"] });

    const report = await fetch(
      `${baseUrl}/api/ledger/transactions?month=2026-10`,
    );
    const body = (await report.json()) as {
      transactions: unknown[];
      expense_total: number;
    };
    expect(report.status).toBe(200);
    expect(body.transactions).toHaveLength(1);
    expect(body.expense_total).toBe(2500);
  });
});

describe.skipIf(!existsSync(webIndex))("static SPA serving (web build)", () => {
  it("/ serves the web index with no-store", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe.skipIf(!existsSync(mobileIndex))(
  "static SPA serving (mobile build)",
  () => {
    it("/m/ serves the mobile index", async () => {
      const response = await fetch(`${baseUrl}/m/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("/m redirects to /m/", async () => {
      const response = await fetch(`${baseUrl}/m`, { redirect: "manual" });
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe("/m/");
    });
  },
);

// A second real process with a password hash configured: proves the guard
// wiring through main.ts, not just the app factory.
describe("http contract (auth enabled)", () => {
  const passwordHash = hashPassword("integration-password");
  const authDataRoot = mkdtempSync(
    path.join(tmpdir(), "toby-auth-integration-"),
  );
  let authUrl: string;
  let authProcess: ReturnType<typeof spawn>;

  beforeAll(async () => {
    const port = await reservePort();
    authUrl = `http://127.0.0.1:${port}`;
    authProcess = spawn(process.execPath, [serverEntry], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TOBY_HOST: "127.0.0.1",
        TOBY_PORT: String(port),
        TOBY_DATA_ROOT: authDataRoot,
        TOBY_LOG_LEVEL: "warn",
        TOBY_AUTH_PASSWORD_HASH: passwordHash,
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    // Health is guarded now; readiness is the exempt session endpoint.
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (authProcess.exitCode !== null) {
        throw new Error(`auth server exited early (${authProcess.exitCode})`);
      }
      if (Date.now() > deadline) {
        throw new Error("auth server not up within 20s");
      }
      try {
        const response = await fetch(`${authUrl}/api/auth/session`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          break;
        }
      } catch {
        // Not up yet — keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 30_000);

  afterAll(async () => {
    if (authProcess && authProcess.exitCode === null) {
      await new Promise<void>((resolve) => {
        authProcess.once("exit", () => resolve());
        authProcess.kill();
        setTimeout(() => {
          authProcess.kill("SIGKILL");
          resolve();
        }, 5_000).unref();
      });
    }
    rmSync(authDataRoot, { recursive: true, force: true });
  });

  it("guards the API until login, then opens it", async () => {
    const denied = await fetch(`${authUrl}/api/ledger/months`);
    expect(denied.status).toBe(401);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    expect(deniedBody.error.code).toBe("AUTH_REQUIRED");

    const wrong = await fetch(`${authUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`${authUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "integration-password" }),
    });
    expect(right.status).toBe(200);
    const setCookie = right.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("toby_session=");
    expect(setCookie).toContain("HttpOnly");
    const cookie = setCookie.split(";")[0] ?? "";

    const months = await fetch(`${authUrl}/api/ledger/months`, {
      headers: { cookie },
    });
    expect(months.status).toBe(200);
    expect(await months.json()).toEqual({ months: [] });

    const session = await fetch(`${authUrl}/api/auth/session`, {
      headers: { cookie },
    });
    const sessionBody = (await session.json()) as { authenticated: boolean };
    expect(sessionBody.authenticated).toBe(true);
  });
});
