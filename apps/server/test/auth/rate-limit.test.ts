/**
 * Login rate limiter with an injected clock: fixed window per IP, 429 with
 * remaining seconds, and clean recovery when the window rolls over.
 */

import { describe, expect, it } from "vitest";
import { createLoginRateLimiter } from "../../src/domains/auth/rate-limit.ts";

const BASE_MS = Date.parse("2026-10-20T08:00:00.000Z");
const WINDOW_MS = 60_000;

function makeLimiter(max = 3) {
  let nowMs = BASE_MS;
  return {
    limiter: createLoginRateLimiter({
      now: () => nowMs,
      windowMs: WINDOW_MS,
      max,
    }),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("login rate limiter", () => {
  it("allows up to max attempts per window per IP", () => {
    const { limiter } = makeLimiter(3);
    expect(limiter.attempt("1.2.3.4")).toEqual({ allowed: true });
    expect(limiter.attempt("1.2.3.4").allowed).toBe(true);
    expect(limiter.attempt("1.2.3.4").allowed).toBe(true);
    const blocked = limiter.attempt("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    // Other IPs are unaffected.
    expect(limiter.attempt("5.6.7.8").allowed).toBe(true);
  });

  it("recovers once the window rolls over", () => {
    const { limiter, advance } = makeLimiter(2);
    limiter.attempt("1.2.3.4");
    limiter.attempt("1.2.3.4");
    expect(limiter.attempt("1.2.3.4").allowed).toBe(false);
    advance(WINDOW_MS + 1);
    const after = limiter.attempt("1.2.3.4");
    expect(after.allowed).toBe(true);
    // Retry-After shrinks inside a window.
    limiter.attempt("1.2.3.4");
    const blocked = limiter.attempt("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(blocked.retryAfterSeconds!).toBeGreaterThan(0);
  });
});
