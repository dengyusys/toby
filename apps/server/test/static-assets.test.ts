/**
 * Static dual mount with real build roots: PC at /, mobile at /m/, both
 * no-store; /m redirects to /m/; missing files fall through to the JSON
 * PAGE_NOT_FOUND envelope.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../src/infrastructure/http/app.ts";

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

let app: FastifyInstance;

beforeEach(() => {
  app = createServer({ webRoot, mobileWebRoot: mobileRoot });
});

afterEach(async () => {
  await app.close();
});

describe("static dual mount", () => {
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

  it("redirects /m to /m/ with 301 and no-store", async () => {
    const response = await app.inject({ method: "GET", url: "/m" });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/m/");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("missing files fall through to the JSON 404 envelope", async () => {
    const response = await app.inject({ method: "GET", url: "/missing.js" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "PAGE_NOT_FOUND", message: "page not found" },
    });
  });
});
