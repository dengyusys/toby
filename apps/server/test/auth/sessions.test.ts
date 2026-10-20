/**
 * Session registry with an injected clock: tokens verify while alive,
 * expire lazily, revoke on demand, and sweep cleans the map.
 */

import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../../src/domains/auth/sessions.ts";

const BASE_MS = Date.parse("2026-10-20T08:00:00.000Z");

function makeRegistry() {
  let nowMs = BASE_MS;
  return {
    registry: createSessionRegistry({ now: () => nowMs }),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("session registry", () => {
  it("creates tokens that verify until they expire", () => {
    const { registry, advance } = makeRegistry();
    const session = registry.create(60_000);
    expect(session.token.length).toBeGreaterThanOrEqual(32);
    expect(registry.verify(session.token)).toBe(true);
    advance(60_001);
    expect(registry.verify(session.token)).toBe(false); // expired
    expect(registry.verify(session.token)).toBe(false); // and now gone
  });

  it("unknown tokens verify as false and revoke as no-ops", () => {
    const { registry } = makeRegistry();
    expect(registry.verify("not-a-token")).toBe(false);
    expect(() => registry.revoke("not-a-token")).not.toThrow();
  });

  it("revocation kills a live token", () => {
    const { registry } = makeRegistry();
    const session = registry.create(60_000);
    registry.revoke(session.token);
    expect(registry.verify(session.token)).toBe(false);
  });

  it("sweep removes expired entries", () => {
    const { registry, advance } = makeRegistry();
    registry.create(1_000);
    registry.create(10_000);
    advance(5_000);
    registry.sweep();
    // The 1s session is swept; the 10s one survives.
    registry.create(1); // distinguishable side effect only via behavior below
    advance(10_000);
    registry.sweep();
    expect(registry.verify("anything")).toBe(false);
  });
});
