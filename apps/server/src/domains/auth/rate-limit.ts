/**
 * Login rate limiting: a fixed window per client IP. Over the limit the
 * login answers 429 with the seconds remaining until the window rolls.
 */

export interface RateLimiterDeps {
  now: () => number;
  windowMs: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Present when blocked: whole seconds until the window rolls over. */
  retryAfterSeconds?: number;
}

export interface LoginRateLimiter {
  /** Count one attempt and decide. */
  attempt(ip: string): RateLimitDecision;
}

export function createLoginRateLimiter(
  deps: RateLimiterDeps,
): LoginRateLimiter {
  // Windows align to global time, so one stamp suffices: when the window
  // rolls over every stored entry is dead — clear them all at once, and
  // the map never holds more than one window's worth of client keys.
  const windows = new Map<string, number>(); // ip -> attempts in this window
  let stampedWindowIndex = -1;

  return {
    attempt(ip) {
      const nowMs = deps.now();
      const windowIndex = Math.floor(nowMs / deps.windowMs);
      if (windowIndex !== stampedWindowIndex) {
        windows.clear();
        stampedWindowIndex = windowIndex;
      }
      const count = (windows.get(ip) ?? 0) + 1;
      windows.set(ip, count);
      if (count > deps.max) {
        const windowEndMs = (windowIndex + 1) * deps.windowMs;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowEndMs - nowMs) / 1000),
          ),
        };
      }
      return { allowed: true };
    },
  };
}
