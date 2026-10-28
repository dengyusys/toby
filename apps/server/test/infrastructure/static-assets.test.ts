/**
 * Static dual mount with real build roots: PC at /, mobile at /m/, both
 * no-store; /m redirects to /m/; missing files fall through to the JSON
 * PAGE_NOT_FOUND body (the not-found answer the Nest app installs).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { SystemModule } from "../../src/domains/system/system.module.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-static-"));
const webRoot = path.join(baseDir, "web-dist");
const mobileRoot = path.join(baseDir, "mobile-dist");

mkdirSync(webRoot, { recursive: true });
writeFileSync(path.join(webRoot, "index.html"), "<html>pc</html>");
mkdirSync(mobileRoot, { recursive: true });
writeFileSync(path.join(mobileRoot, "index.html"), "<html>mobile</html>");

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

let app: NestNodeApplication;

beforeEach(async () => {
  // The SPA roots come from the config, exactly as they do in production.
  const config = resolveConfig({ env: { TOBY_DATA_ROOT: baseDir } });
  app = await createTestApp({
    config: {
      ...config,
      paths: { ...config.paths, webRoot, mobileWebRoot: mobileRoot },
    },
    modules: [SystemModule],
  });
});

afterEach(async () => {
  await app.close();
});

function http() {
  return request(app.getHttpServer());
}

describe("static dual mount", () => {
  it("serves the PC entry at / with no-store", async () => {
    const response = await http().get("/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("pc");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("serves the mobile entry at /m/ with no-store", async () => {
    const response = await http().get("/m/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("mobile");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("redirects /m to /m/ with a 3xx and no-store", async () => {
    const response = await http().get("/m");
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.location).toBe("/m/");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("missing files fall through to the JSON 404 body", async () => {
    const response = await http().get("/missing.js");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "page not found",
      error: "Not Found",
      errorCode: "PAGE_NOT_FOUND",
    });
  });
});
