/**
 * System domain HTTP contract, exercised through the test fixture over a
 * real HTTP server: health, info, the not-found body, and the shared
 * response headers.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";
import { createTestApp } from "../app-fixture.ts";

const tempDir = mkdtempSync(path.join(tmpdir(), "toby-system-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let app: NestNodeApplication;

beforeEach(async () => {
  app = await createTestApp({
    config: resolveConfig({ env: { TOBY_DATA_ROOT: tempDir } }),
    modules: [SystemModule],
  });
});

afterEach(async () => {
  await app.close();
});

function http() {
  return request(app.getHttpServer());
}

describe("system api", () => {
  it("health returns the liveness body with no-store", async () => {
    const response = await http().get("/api/system/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("info exposes name, version, node, started_at, uptime", async () => {
    const response = await http().get("/api/system/info");
    expect(response.status).toBe(200);
    const body = response.body;
    expect(body.name).toBe("toby");
    expect(typeof body.version).toBe("string");
    expect(body.node).toBe(process.versions.node);
    expect(!Number.isNaN(Date.parse(body.started_at))).toBe(true);
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("unknown paths get the PAGE_NOT_FOUND body", async () => {
    const response = await http().get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "page not found",
      error: "Not Found",
      errorCode: "PAGE_NOT_FOUND",
    });
  });

  it("a method mismatch is a not-found like any other unmatched request", async () => {
    const response = await http().post("/api/system/health");
    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe("PAGE_NOT_FOUND");
  });

  it("an undecodable path is rejected with a 400", async () => {
    const response = await http().get("/%zz");
    expect(response.status).toBe(400);
  });

  it("missing static roots only affect static serving, not the API", async () => {
    const response = await http().get("/");
    expect(response.status).toBe(404);
  });
});
