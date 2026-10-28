/**
 * Error boundary as the global Nest exception filter: an invalid JSON body,
 * an oversized body, a domain exception, and the sanitized 500 fallback,
 * exercised through a probe controller and the HTTP server supertest drives.
 */

import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  type DynamicModule,
} from "@nestjs/common";
import { z } from "zod";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { DomainHttpError } from "../../src/infrastructure/http/http-error.ts";
import { createTestApp } from "../app-fixture.ts";

// Test-local routes: a JSON body route (to trigger parse errors) and two
// routes that throw — one domain exception, one plain error.
@Controller("api/probe")
class ProbeController {
  @Post("json")
  @HttpCode(HttpStatus.OK)
  json(): { ok: boolean } {
    return { ok: true };
  }

  @Post("validated")
  @HttpCode(HttpStatus.OK)
  validated(
    @Body({ schema: z.object({ age: z.number() }) })
    body: {
      age: number;
    },
  ): { age: number } {
    return body;
  }

  @Get("domain-error")
  domainError(): never {
    throw new DomainHttpError(
      HttpStatus.I_AM_A_TEAPOT,
      "DOMAIN_ERROR",
      "domain says no",
    );
  }

  @Get("crash")
  crash(): never {
    throw new Error("unexpected kaboom");
  }
}

const probeModule: DynamicModule = {
  module: class ProbeModule {},
  controllers: [ProbeController],
};

let app: NestNodeApplication;

beforeEach(async () => {
  // The probe module touches no database; a never-created data root is
  // enough for the config shape.
  app = await createTestApp({
    config: resolveConfig({
      env: { TOBY_DATA_ROOT: path.join(tmpdir(), "toby-error-handler-probe") },
    }),
    modules: [probeModule],
  });
});

afterEach(async () => {
  await app.close();
});

function http() {
  return request(app.getHttpServer());
}

describe("error boundary", () => {
  it("invalid JSON is a 400 carrying a code", async () => {
    const response = await http()
      .post("/api/probe/json")
      .set("content-type", "application/json")
      .send("{ not json");
    expect(response.status).toBe(400);
    // Nest maps the parser's SyntaxError; the filter only supplies the code.
    expect(response.body.errorCode).toBe("BAD_REQUEST");
    expect(typeof response.body.message).toBe("string");
  });

  it("an empty JSON body parses as {} and reaches the handler", async () => {
    const response = await http()
      .post("/api/probe/json")
      .set("content-type", "application/json")
      .send("");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("a body over the 16 KiB limit is a 413 PAYLOAD_TOO_LARGE", async () => {
    const response = await http()
      .post("/api/probe/json")
      .set("content-type", "application/json")
      .send("x".repeat(16 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(response.body.errorCode).toBe("PAYLOAD_TOO_LARGE");
  });

  it("a validation issue list is flattened into one message", async () => {
    const response = await http()
      .post("/api/probe/validated")
      .set("content-type", "application/json")
      .send({ age: "old" });
    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe("BAD_REQUEST");
    expect(response.body.message).toContain("age");
  });

  it("domain exceptions keep their own code and status", async () => {
    const response = await http().get("/api/probe/domain-error");
    expect(response.status).toBe(418);
    expect(response.body).toEqual({
      statusCode: 418,
      message: "domain says no",
      error: "I'm a Teapot",
      errorCode: "DOMAIN_ERROR",
    });
  });

  it("unexpected errors keep the stack server-side", async () => {
    const response = await http().get("/api/probe/crash");
    expect(response.status).toBe(500);
    // Nest's own 500 body: the framework answers and reports the error
    // through its logger; nothing of the stack goes out.
    expect(response.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
  });
});
