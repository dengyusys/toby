/**
 * Error boundary and body parsing over the real shell: invalid and hostile
 * JSON, an oversized body, form and unknown content types, a domain
 * exception, malformed statuses, and the sanitized 500 fallback, exercised
 * through probe routes and fastify inject.
 */

import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { parseBody } from "../../src/infrastructure/http/body-schema.ts";
import { DomainHttpError } from "../../src/infrastructure/http/http-error.ts";
import { createTestApp } from "../app-fixture.ts";

// Test-local routes: body routes (to trigger parse errors and inspect what
// the parsers produce) and routes that throw — a domain exception, plain
// errors, and errors carrying statuses that are not real error statuses.
const probeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/probe/json", () => ({ ok: true }));

  app.post("/api/probe/echo", (request) => ({ body: request.body ?? null }));

  app.post("/api/probe/validated", (request) =>
    parseBody(z.object({ age: z.number() }), request),
  );

  app.get("/api/probe/domain-error", (): never => {
    throw new DomainHttpError(418, "DOMAIN_ERROR", "domain says no");
  });

  app.get("/api/probe/bad-domain-status", (): never => {
    throw new DomainHttpError(200, "NOT_AN_ERROR", "a 200 is no failure");
  });

  app.get("/api/probe/fractional-status", (): never => {
    throw Object.assign(new Error("odd status"), { statusCode: 400.5 });
  });

  app.get("/api/probe/crash", (): never => {
    throw new Error("unexpected kaboom");
  });
};

let app: FastifyInstance;

beforeEach(async () => {
  // The probe routes touch no database; a never-created data root is
  // enough for the config shape.
  app = await createTestApp({
    config: resolveConfig({
      env: { TOBY_DATA_ROOT: path.join(tmpdir(), "toby-error-handler-probe") },
    }),
    domains: [(instance) => instance.register(probeRoutes)],
  });
});

afterEach(async () => {
  await app.close();
});

describe("error boundary", () => {
  it("invalid JSON is a 400 carrying a code", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "{ not json",
    });
    expect(response.statusCode).toBe(400);
    // The parser rejects; the boundary only supplies the code.
    expect(response.json().errorCode).toBe("BAD_REQUEST");
    expect(typeof response.json().message).toBe("string");
  });

  it("an empty JSON body parses as {} and reaches the handler", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("a body over the 16 KiB limit is a 413 PAYLOAD_TOO_LARGE", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/json",
      headers: { "content-type": "application/json" },
      payload: "x".repeat(16 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().errorCode).toBe("PAYLOAD_TOO_LARGE");
  });

  it("a validation issue list is flattened into one message", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/validated",
      payload: { age: "old" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("BAD_REQUEST");
    expect(response.json().message).toContain("age");
  });

  it("domain exceptions keep their own code and status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/probe/domain-error",
    });
    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({
      statusCode: 418,
      message: "domain says no",
      error: "I'm a Teapot",
      errorCode: "DOMAIN_ERROR",
    });
  });

  it("unexpected errors keep the stack server-side", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app.inject({
      method: "GET",
      url: "/api/probe/crash",
    });
    expect(response.statusCode).toBe(500);
    // The sanitized 500: the boundary answers and reports the error to
    // stderr once — as a stack string, never the error object with its
    // properties; nothing of the stack goes out.
    expect(response.json()).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
    expect(report).toHaveBeenCalledOnce();
    expect(typeof report.mock.calls[0]?.[1]).toBe("string");
    expect(report.mock.calls[0]?.[1]).toContain("unexpected kaboom");
    report.mockRestore();
  });

  it("statuses that are not real error statuses end in the sanitized 500", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const url of [
      "/api/probe/bad-domain-status",
      "/api/probe/fractional-status",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        statusCode: 500,
        message: "Internal server error",
      });
    }
    report.mockRestore();
  });
});

describe("body parsing", () => {
  it("prototype-poisoning JSON is a 400", async () => {
    for (const payload of [
      '{"__proto__":{"polluted":1}}',
      '{"constructor":{"prototype":{"polluted":1}}}',
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/probe/echo",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("BAD_REQUEST");
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("a UTF-8 BOM in front of JSON is tolerated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/echo",
      headers: { "content-type": "application/json" },
      payload: '\uFEFF{"a":1}',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: { a: 1 } });
  });

  it("URL-encoded forms parse flat; a repeated key becomes an array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/echo",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "a=1&a=2&b=3&__proto__=x",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      body: { a: ["1", "2"], b: "3", ["__proto__"]: "x" },
    });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("a content type without a parser leaves no body, not a 415", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/echo",
      headers: { "content-type": "application/vnd.api+json" },
      payload: '{"a":1}',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: null });
  });

  it("the body limit holds for every content type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/probe/echo",
      headers: { "content-type": "application/octet-stream" },
      payload: "x".repeat(16 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().errorCode).toBe("PAYLOAD_TOO_LARGE");
  });
});
