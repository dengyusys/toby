/**
 * In-memory session registry: high-entropy tokens in cookies, only SHA-256
 * digests with expiry timestamps on the server. A process restart
 * invalidates every session — accepted for a single-user assistant.
 */

import { createHash, randomBytes } from "node:crypto";

export interface SessionHandle {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface SessionRegistryDeps {
  now: () => number;
}

export interface SessionRegistry {
  create(ttlMs: number): SessionHandle;
  /** Expired or unknown tokens verify as false; expiry is lazy. */
  verify(token: string): boolean;
  /** Expiry timestamp for a live session; undefined for unknown/expired. */
  expiryOf(token: string): number | undefined;
  /** Unknown tokens revoke as no-ops. */
  revoke(token: string): void;
  sweep(): void;
}

function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionRegistry(
  deps: SessionRegistryDeps,
): SessionRegistry {
  const sessions = new Map<string, number>(); // sha256(token) -> expiresAtMs

  function expiryOf(token: string): number | undefined {
    const expiresAtMs = sessions.get(digestOf(token));
    if (expiresAtMs === undefined) {
      return undefined;
    }
    if (deps.now() >= expiresAtMs) {
      sessions.delete(digestOf(token));
      return undefined;
    }
    return expiresAtMs;
  }

  return {
    create(ttlMs) {
      const token = randomBytes(32).toString("base64url");
      const expiresAtMs = deps.now() + ttlMs;
      sessions.set(digestOf(token), expiresAtMs);
      return { token, expiresAtMs };
    },

    verify(token) {
      return expiryOf(token) !== undefined;
    },

    expiryOf,

    revoke(token) {
      sessions.delete(digestOf(token));
    },

    sweep() {
      const nowMs = deps.now();
      for (const [key, expiresAtMs] of sessions) {
        if (nowMs >= expiresAtMs) {
          sessions.delete(key);
        }
      }
    },
  };
}
