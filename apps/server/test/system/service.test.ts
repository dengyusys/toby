/**
 * System service unit tests: no HTTP, no Fastify — the injectable clock and
 * version pin the output deterministically.
 */

import { describe, expect, it } from "vitest";
import { assembleSystemService } from "../../src/domains/system/service.ts";

describe("system service", () => {
  it("health is always ok", () => {
    expect(assembleSystemService().health()).toEqual({ status: "ok" });
  });

  it("info assembles identity with an injected clock", () => {
    const startedAt = new Date("2026-10-11T00:00:00.000Z");
    let clock = startedAt.getTime();
    const service = assembleSystemService({
      version: "9.9.9",
      startedAt,
      now: () => clock,
    });
    expect(service.info()).toEqual({
      name: "toby",
      version: "9.9.9",
      node: process.versions.node,
      started_at: "2026-10-11T00:00:00.000Z",
      uptime_seconds: 0,
    });
    clock += 90_000;
    expect(service.info().uptime_seconds).toBe(90);
  });
});
