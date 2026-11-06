/**
 * System domain HTTP contract, exercised through the test fixture over the
 * full request lifecycle: health, info, the not-found body, and the shared
 * response headers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { systemPlugin } from "../../src/domains/system/plugin.ts";
import { createTestApp } from "../app-fixture.ts";

const tempDir = mkdtempSync(path.join(tmpdir(), "toby-system-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let app: FastifyInstance;

beforeEach(async () => {
  app = await createTestApp({
    config: resolveConfig({ env: { TOBY_DATA_ROOT: tempDir } }),
    domains: [(instance) => instance.register(systemPlugin({}))],
  });
});

afterEach(async () => {
  await app.close();
});

describe("system api", () => {
  it("health returns the liveness body with no-store", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/system/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
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

  it("unknown paths get the PAGE_NOT_FOUND body", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      statusCode: 404,
      message: "page not found",
      error: "Not Found",
      errorCode: "PAGE_NOT_FOUND",
    });
  });

  it("a method mismatch is a not-found like any other unmatched request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/system/health",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().errorCode).toBe("PAGE_NOT_FOUND");
  });

  it("an undecodable path is rejected with a 400 in the shared body", async () => {
    const response = await app.inject({ method: "GET", url: "/%zz" });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("BAD_REQUEST");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("one trailing slash on an /api path is optional, query included", async () => {
    for (const url of ["/api/system/health/", "/api/system/health/?probe=1"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    }
  });

  it("missing static roots only affect static serving, not the API", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
  });
});
