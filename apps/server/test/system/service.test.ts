/**
 * System service unit tests: no HTTP, no adapter — the injectable clock
 * pins started_at and drives uptime deterministically.
 */

import { describe, expect, it } from "vitest";
import { SystemService } from "../../src/domains/system/system.service.ts";

describe("system service", () => {
  it("health is a constant liveness answer", () => {
    expect(new SystemService(Date.now).health()).toEqual({ status: "ok" });
  });

  it("info assembles identity with an injected clock", () => {
    let clock = Date.parse("2026-10-11T00:00:00.000Z");
    const service = new SystemService(() => clock);
    const info = service.info();
    expect(info.name).toBe("toby");
    expect(typeof info.version).toBe("string");
    expect(info.node).toBe(process.versions.node);
    expect(info.started_at).toBe("2026-10-11T00:00:00.000Z");
    expect(info.uptime_seconds).toBe(0);
    clock += 90_000;
    expect(service.info().uptime_seconds).toBe(90);
  });
});
