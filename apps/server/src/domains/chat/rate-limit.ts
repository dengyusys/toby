/**
 * A fixed-window per-key limiter for the chat send endpoint
 * (docs/features/chat.md: 20 requests / 60 s / IP). In-process by design —
 * the server is single-process; restart clears the windows, which the
 * 60 s horizon makes harmless.
 */

export interface RateLimiter {
  /** True when the key still has budget in the current window. */
  consume(key: string): boolean;
}

export function createRateLimiter(deps: {
  now: () => number;
  limit?: number;
  windowMs?: number;
}): RateLimiter {
  const limit = deps.limit ?? 20;
  const windowMs = deps.windowMs ?? 60_000;
  const windows = new Map<string, { startMs: number; count: number }>();

  return {
    consume(key) {
      const nowMs = deps.now();
      const current = windows.get(key);
      if (!current || nowMs - current.startMs >= windowMs) {
        // Opportunistic sweep: drop expired windows so the map stays
        // bounded without a timer of its own.
        if (windows.size > 1_000) {
          for (const [k, w] of windows) {
            if (nowMs - w.startMs >= windowMs) {
              windows.delete(k);
            }
          }
        }
        windows.set(key, { startMs: nowMs, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
  };
}
