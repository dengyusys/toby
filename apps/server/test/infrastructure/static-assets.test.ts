/**
 * Static dual mount with real build roots: PC at /, mobile at /m/, both
 * no-store; /m redirects to /m/; missing files fall through to the JSON
 * PAGE_NOT_FOUND envelope (the not-found reply the Nest app installs).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { staticAssetsPlugin } from "../../src/infrastructure/http/static-assets.ts";
import {
  HTTP_STATUS,
  createErrorResponse,
} from "../../src/infrastructure/http/contract.ts";
import { sendJsonReply } from "../../src/infrastructure/http/response.ts";

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

beforeEach(async () => {
  app = Fastify({ logger: false });
  app.setNotFoundHandler((_request, reply) => {
    sendJsonReply(
      reply,
      HTTP_STATUS.notFound,
      createErrorResponse("PAGE_NOT_FOUND", "page not found"),
    );
  });
  await app.register(staticAssetsPlugin, {
    webRoot,
    mobileWebRoot: mobileRoot,
    warn: () => {},
  });
  await app.ready();
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
