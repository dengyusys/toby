/**
 * System domain HTTP contract, exercised through the test fixture:
 * health, info, the 404/405 discrimination, and the shared response
 * headers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";
import { createTestApp } from "../app-fixture.ts";
import type { NestServer } from "../../src/infrastructure/http/nest-app.ts";

const tempDir = mkdtempSync(path.join(tmpdir(), "toby-system-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let app: NestServer;

beforeEach(async () => {
  app = await createTestApp({
    config: resolveConfig({ env: { TOBY_DATA_ROOT: tempDir } }),
    modules: [SystemModule],
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

  it("an encoded path still discriminates as 405, like the router does", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/%73ystem/health",
    });
    expect(response.statusCode).toBe(405);
    expect(response.json().error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("an undecodable path is rejected by the router as 400", async () => {
    // Fastify refuses malformed percent-encoding before routing; the
    // filter's decode fallback is defense in depth for anything that
    // slips past this gate.
    const response = await app.inject({ method: "GET", url: "/%zz" });
    expect(response.statusCode).toBe(400);
  });

  it("missing static roots only affect static serving, not the API", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
  });
});
