/**
 * Static dual mount with real build roots: PC at /, mobile at /m/, both
 * no-store; /m redirects to /m/; missing files fall through to the JSON
 * PAGE_NOT_FOUND body (the not-found answer the shell installs). The dev
 * redirect mode replaces both mounts: entries bounce to the vite dev
 * servers even though the dist builds exist, and nothing is served.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { systemPlugin } from "../../src/domains/system/plugin.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-static-"));
const webRoot = path.join(baseDir, "web-dist");
const mobileWebRoot = path.join(baseDir, "mobile-dist");

mkdirSync(webRoot, { recursive: true });
writeFileSync(path.join(webRoot, "index.html"), "<html>pc</html>");
writeFileSync(path.join(webRoot, ".secret"), "deploy key");
mkdirSync(path.join(webRoot, "assets"), { recursive: true });
writeFileSync(path.join(webRoot, "assets", "index.js"), "console.log(1)");
mkdirSync(mobileWebRoot, { recursive: true });
writeFileSync(path.join(mobileWebRoot, "index.html"), "<html>mobile</html>");

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("static dual mount", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestApp({
      config: resolveConfig({ env: { TOBY_DATA_ROOT: baseDir } }),
      staticRoots: { webRoot, mobileWebRoot },
      domains: [(instance) => instance.register(systemPlugin({}))],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves the PC entry at / with no-store", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("pc");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("serves the mobile entry at /m/ with no-store", async () => {
    const response = await app.inject({ method: "GET", url: "/m/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("mobile");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("redirects /m to /m/ with a 3xx and no-store", async () => {
    const response = await app.inject({ method: "GET", url: "/m" });
    expect(response.statusCode).toBeGreaterThanOrEqual(300);
    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers.location).toBe("/m/");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("missing files fall through to the JSON 404 body", async () => {
    const response = await app.inject({ method: "GET", url: "/missing.js" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      statusCode: 404,
      message: "page not found",
      error: "Not Found",
      errorCode: "PAGE_NOT_FOUND",
    });
  });

  it("dotfiles are ignored, like any missing file", async () => {
    const response = await app.inject({ method: "GET", url: "/.secret" });
    expect(response.statusCode).toBe(404);
    expect(response.json().errorCode).toBe("PAGE_NOT_FOUND");
  });

  it("other static errors keep their status and its historic code", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/",
      headers: { range: "bytes=999999-" },
    });
    expect(response.statusCode).toBe(416);
    expect(response.json().errorCode).toBe("REQUESTED_RANGE_NOT_SATISFIABLE");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("doubled separators collapse and serve; escapes stay not-founds", async () => {
    // (Literal dot-segment rows are client-normalized by inject, so their
    // server-side semantics are pinned by the request-url unit tests and
    // the raw-socket differential run instead.)
    for (const [url, contains] of [
      ["//", "pc"],
      ["//index.html", "pc"],
      ["/assets//index.js", "console"],
    ] as Array<[string, string]>) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain(contains);
    }
    for (const url of ["/../package.json", "/%2e%2e/package.json"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.json().errorCode).toBe("PAGE_NOT_FOUND");
    }
  });
});

describe("dev page redirects", () => {
  // Same real dist roots as the serving tests — the point is that the
  // redirect mode wins even though builds exist on disk.
  let devApp: FastifyInstance;

  beforeEach(async () => {
    devApp = await createTestApp({
      config: resolveConfig({
        env: {
          TOBY_DATA_ROOT: baseDir,
          TOBY_DEV_PC_ORIGIN: "http://localhost:8630",
          TOBY_DEV_MOBILE_ORIGIN: "http://localhost:8631/m",
        },
      }),
      staticRoots: { webRoot, mobileWebRoot },
      domains: [(instance) => instance.register(systemPlugin({}))],
    });
  });

  afterEach(async () => {
    await devApp.close();
  });

  it("/ bounces to the PC dev server with no-store", async () => {
    const response = await devApp.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://localhost:8630/");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("/m and /m/ bounce to the mobile dev server", async () => {
    for (const url of ["/m", "/m/"]) {
      const response = await devApp.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(302);
      expect(response.headers.location, url).toBe("http://localhost:8631/m/");
    }
  });

  it("nothing is served from the dist builds", async () => {
    for (const url of ["/index.html", "/assets/index.js", "/m/index.html"]) {
      const response = await devApp.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.json().errorCode, url).toBe("PAGE_NOT_FOUND");
    }
  });

  it("API routes are untouched", async () => {
    const response = await devApp.inject({
      method: "GET",
      url: "/api/system/health",
    });
    expect(response.statusCode).toBe(200);
  });
});
