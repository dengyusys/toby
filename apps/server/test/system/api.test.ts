/**
 * System domain HTTP contract, exercised through app.inject: health, info,
 * the 404/405 discrimination, and the shared response headers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNestServer,
  type NestServer,
} from "../../src/infrastructure/http/nest-app.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";

// Non-existent static roots: the API server must still work (fresh clone
// without web builds) and warn instead of crashing.
const tempDir = mkdtempSync(path.join(tmpdir(), "toby-system-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let app: NestServer;

beforeEach(async () => {
  app = await createNestServer({
    webRoot: path.join(tempDir, "web"),
    mobileWebRoot: path.join(tempDir, "mobile"),
    domainModules: [SystemModule],
  });
});

afterEach(async () => {
  await app.close();
});

describe("system api", () => {
  it("health returns ok with no-store json", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/system/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("info exposes name, version, node, started_at, uptime", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/system/info",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe("toby");
    expect(typeof body.version).toBe("string");
    expect(body.node).toBe(process.versions.node);
    expect(!Number.isNaN(Date.parse(body.started_at))).toBe(true);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("unknown paths get the PAGE_NOT_FOUND envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "PAGE_NOT_FOUND", message: "page not found" },
    });
  });

  it("method mismatch is discriminated as 405", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/system/health",
    });
    expect(response.statusCode).toBe(405);
    expect(response.json()).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" },
    });
  });

  it("missing static roots only affect static serving, not the API", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
  });
});
