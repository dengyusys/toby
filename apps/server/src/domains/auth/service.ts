/**
 * Auth service: single-user login over a password the owner sets on the
 * first-run registration page. The clock is injected so tests drive expiry
 * and the registration window; no plaintext password or token is retained.
 */

import type {
  AuthConfig,
  TobyConfig,
} from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { AuthError } from "./errors.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { AuthRepository } from "./repository.ts";
import {
  createSessionRegistry,
  type SessionHandle,
  type SessionRegistry,
} from "./sessions.ts";
import type { AuthLoginSuccess, AuthSessionInfo } from "./types.ts";

type SessionGrant = SessionHandle;

/** Session pruning cadence; lazy expiry already covers correctness. */
const SESSION_SWEEP_INTERVAL_MS = 60_000;

/**
 * How long after startup the one-time registration stays open. On a server
 * left unregistered, whoever reaches the registration page first would set
 * the password; the window turns "forgotten for a day" into "closed". A
 * restart reopens it.
 */
export const REGISTRATION_WINDOW_MS = 10 * 60_000;

export interface AuthService {
  /** Wrong password 401 — including before the owner has registered. */
  login(password: string): Promise<SessionGrant>;
  /**
   * The one-time first run: closed once a password exists
   * (ALREADY_REGISTERED) or the startup window has passed
   * (REGISTRATION_CLOSED). Success starts a session.
   */
  register(password: string): Promise<SessionGrant>;
  /** Idempotent: unknown or missing tokens revoke as no-ops. */
  logout(token: string | undefined): Promise<void>;
  session(token: string | undefined): Promise<AuthSessionInfo>;
  /**
   * Session check for the route guard. The exemption decision belongs to
   * the route that wires the guard in — the URL string never enters it, so
   * encoded-path tricks cannot dodge it.
   */
  requireSession(token: string | undefined): void;
  start(): void;
  stop(): void;
}

export function createAuthService(deps: {
  config: TobyConfig;
  clock: Clock;
  repository: AuthRepository;
}): AuthService {
  const config: AuthConfig = deps.config.auth;
  const sessions: SessionRegistry = createSessionRegistry({
    now: deps.clock,
  });
  const registrationDeadlineMs = deps.clock() + REGISTRATION_WINDOW_MS;
  let timer: NodeJS.Timeout | undefined;

  return {
    async login(password) {
      // No stored hash means nobody can log in: the same wrong-password 401,
      // answered without hashing anything.
      const stored = await deps.repository.getPasswordHash();
      if (
        typeof password !== "string" ||
        stored === null ||
        !verifyPassword(password, stored)
      ) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "wrong password");
      }
      return sessions.create(config.sessionTtlMs);
    },

    async register(password) {
      if (deps.clock() >= registrationDeadlineMs) {
        throw new AuthError(
          "REGISTRATION_CLOSED",
          403,
          "the registration window has closed; restart the server to reopen it",
        );
      }
      if ((await deps.repository.getPasswordHash()) !== null) {
        throw new AuthError(
          "ALREADY_REGISTERED",
          403,
          "a password is already set",
        );
      }
      const stored = await deps.repository.setFirstPasswordHash(
        hashPassword(password),
      );
      // Lost a race with a concurrent registration: that one's password stands.
      if (!stored) {
        throw new AuthError(
          "ALREADY_REGISTERED",
          403,
          "a password is already set",
        );
      }
      return sessions.create(config.sessionTtlMs);
    },

    async logout(token) {
      if (token !== undefined) {
        sessions.revoke(token);
      }
    },

    async session(token) {
      if ((await deps.repository.getPasswordHash()) === null) {
        return { state: "unregistered" };
      }
      const expiresAtMs =
        token === undefined ? undefined : sessions.expiryOf(token);
      return expiresAtMs === undefined
        ? { state: "unauthenticated" }
        : {
            state: "authenticated",
            expires_at: new Date(expiresAtMs).toISOString(),
          };
    },

    requireSession(token) {
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

/** Login and registration success body — the session travels in the cookie, never JSON. */
export const LOGIN_SUCCESS: AuthLoginSuccess = { status: "ok" };
