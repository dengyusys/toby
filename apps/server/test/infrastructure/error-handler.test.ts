/**
 * Error boundary as the global Nest exception filter: all four branches
 * (invalid JSON, empty JSON body, oversized body, domain-shaped errors)
 * plus the sanitized 500 fallback, exercised through a probe controller
 * and app.inject.
 */

import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Controller, Get, Post } from "@nestjs/common";
import {
  createNestServer,
  type NestServer,
} from "../../src/infrastructure/http/nest-app.ts";

const missingRoot = path.join(
  mkdtempSync(path.join(tmpdir(), "toby-eh-")),
  "no-dist",
);

// Test-local routes: a JSON body route (to trigger parse errors) and two
// routes that throw — one domain-shaped (Error + code + status), one not.
@Controller("api/probe")
class ProbeController {
  @Post("json")
  json(): { ok: boolean } {
    return { ok: true };
  }

  @Get("domain-error")
  domainError(): never {
    throw Object.assign(new Error("domain says no"), {
      code: "DOMAIN_ERROR",
      status: 418,
    });
  }

  @Get("crash")
  crash(): never {
    throw new Error("unexpected kaboom");
  }
}

class ProbeModule {}
const probeModule = {
  module: ProbeModule,
  controllers: [ProbeController],
};

let app: NestServer;

beforeEach(async () => {
  app = await createNestServer({
    webRoot: path.join(missingRoot, "web"),
    mobileWebRoot: path.join(missingRoot, "mobile"),
    domainModules: [probeModule],
  });
});

afterEach(async () => {
  await app.close();
});

describe("error boundary", () => {
  it("invalid JSON body maps to 400 INVALID_JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "request body is not valid JSON",
      },
    });
  });

  it("empty JSON body maps to 400 INVALID_JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "request body must be a JSON object",
      },
    });
  });

  it("a body over the 16 KiB limit maps to 413 PAYLOAD_TOO_LARGE", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "x".repeat(16 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "request body exceeds the limit",
      },
    });
  });

  it("domain-shaped errors keep their own code and status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/probe/domain-error",
    });
    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({
      error: { code: "DOMAIN_ERROR", message: "domain says no" },
    });
  });

  it("unexpected errors are sanitized into a 500 envelope", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/probe/crash",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "internal server error" },
    });
  });
});
