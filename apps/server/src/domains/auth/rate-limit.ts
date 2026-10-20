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
  const windows = new Map<string, { windowIndex: number; count: number }>();

  return {
    attempt(ip) {
      const nowMs = deps.now();
      const windowIndex = Math.floor(nowMs / deps.windowMs);
      const current = windows.get(ip);
      if (!current || current.windowIndex !== windowIndex) {
        windows.set(ip, { windowIndex, count: 1 });
        return { allowed: true };
      }
      current.count += 1;
      if (current.count > deps.max) {
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
