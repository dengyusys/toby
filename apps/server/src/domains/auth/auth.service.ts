/**
 * Auth service: single-user login over a configured password hash. The clock
 * is injected so tests drive expiry; no plaintext password or token is
 * retained.
 */

import type {
  AuthConfig,
  TobyConfig,
} from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { AuthError } from "./errors.ts";
import { verifyPassword } from "./password.ts";
import {
  createSessionRegistry,
  type SessionHandle,
  type SessionRegistry,
} from "./sessions.ts";
import type { AuthLoginSuccess, AuthSessionInfo } from "./types.ts";

/** A freshly created session handle. */
type SessionGrant = SessionHandle;

/** Session pruning cadence; lazy expiry already covers correctness. */
const SESSION_SWEEP_INTERVAL_MS = 60_000;

export interface AuthService {
  /** Wrong password 401, disabled 400. */
  login(password: string): Promise<SessionGrant>;
  /** Idempotent: unknown or missing tokens revoke as no-ops. */
  logout(token: string | undefined): Promise<void>;
  session(token: string | undefined): AuthSessionInfo;
  /**
   * Session check for the route guard. The exemption decision belongs to
   * the route that wires the guard in — the URL string never enters it, so
   * encoded-path tricks cannot dodge it. No-op while authentication is
   * disabled.
   */
  requireSession(token: string | undefined): void;
  /** Starts the session sweeper timer. */
  start(): void;
  /** Stops the sweeper timer. */
  stop(): void;
}

export function createAuthService(deps: {
  config: TobyConfig;
  clock: Clock;
}): AuthService {
  const config: AuthConfig = deps.config.auth;
  const sessions: SessionRegistry = createSessionRegistry({
    now: deps.clock,
  });
  let timer: NodeJS.Timeout | undefined;

  return {
    async login(password) {
      if (!config.enabled) {
        throw new AuthError(
          "AUTH_DISABLED",
          400,
          "authentication is not configured (TOBY_AUTH_PASSWORD_HASH is unset)",
        );
      }
      if (
        typeof password !== "string" ||
        !verifyPassword(password, config.passwordHash)
      ) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "wrong password");
      }
      return sessions.create(config.sessionTtlMs);
    },

    async logout(token) {
      if (token !== undefined) {
        sessions.revoke(token);
      }
    },

    session(token) {
      if (!config.enabled) {
        return { enabled: false, authenticated: false };
      }
      const expiresAtMs =
        token === undefined ? undefined : sessions.expiryOf(token);
      if (expiresAtMs === undefined) {
        return { enabled: true, authenticated: false };
      }
      return {
        enabled: true,
        authenticated: true,
        expires_at: new Date(expiresAtMs).toISOString(),
      };
    },

    requireSession(token) {
      if (!config.enabled) {
        return;
      }
      if (token === undefined || !sessions.verify(token)) {
        throw new AuthError("AUTH_REQUIRED", 401, "login required");
      }
    },

    // Prune expired sessions; bounded memory is the sweeper's only job.
    start() {
      timer = setInterval(() => {
        sessions.sweep();
      }, SESSION_SWEEP_INTERVAL_MS);
      timer.unref();
    },

    stop() {
      clearInterval(timer);
    },
  };
}

/** Login success body — the session travels in the cookie, never JSON. */
export const LOGIN_SUCCESS: AuthLoginSuccess = { status: "ok" };
