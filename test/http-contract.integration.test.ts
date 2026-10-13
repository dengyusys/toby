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

// Repository root from this file's location — never from cwd.
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(repositoryRoot, "apps/server/src/main.ts");
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

afterAll(() => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    // Guard against a child that ignores SIGTERM (hard kill on Windows).
    setTimeout(() => serverProcess.kill("SIGKILL"), 5_000).unref();
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
