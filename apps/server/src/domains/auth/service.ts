/**
 * Auth service: single-user login over a configured password hash. The
 * clock is injected so tests drive expiry and the rate-limit window. No
 * plaintext passwords or tokens are retained or logged.
 */

import type { AuthConfig } from "../../infrastructure/config/config.ts";
import { verifyPassword } from "./password.ts";
import { createLoginRateLimiter } from "./rate-limit.ts";
import { createSessionRegistry } from "./sessions.ts";
import type { AuthLoginSuccess, AuthSessionInfo } from "./types.ts";

/** Domain-shaped error recognized by the unified HTTP error boundary. */
export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    status: number,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AuthServiceDeps {
  now?: () => number;
}

export interface SessionGrant {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface AuthService {
  /** Wrong password 401, over the limit 429, disabled 400. */
  login(password: string, ip: string): Promise<SessionGrant>;
  /** Idempotent: unknown or missing tokens revoke as no-ops. */
  logout(token: string | undefined): Promise<void>;
  session(token: string | undefined): AuthSessionInfo;
  /** The preHandler guard used by the app factory. */
  requireSession(pathname: string, token: string | undefined): void;
}

export const SESSION_COOKIE = "toby_session";

export function assembleAuthService(
  config: AuthConfig,
  deps: AuthServiceDeps = {},
): AuthService {
  const now = deps.now ?? Date.now;
  const sessions = createSessionRegistry({ now });
  const limiter = createLoginRateLimiter({
    now,
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
  });

  return {
    async login(password, ip) {
      if (!config.enabled) {
        throw new AuthError(
          "AUTH_DISABLED",
          400,
          "authentication is not configured (TOBY_AUTH_PASSWORD_HASH is unset)",
        );
      }
      const decision = limiter.attempt(ip);
      if (!decision.allowed) {
        throw new AuthError(
          "RATE_LIMITED",
          429,
          "too many login attempts",
          decision.retryAfterSeconds,
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
      if (token === undefined || !sessions.verify(token)) {
        return { enabled: true, authenticated: false };
      }
      return { enabled: true, authenticated: true };
    },

    requireSession(pathname, token) {
      if (!config.enabled) {
        return;
      }
      // Exemption surface: static pages (they carry the login UI, no
      // business data) and the auth endpoints themselves — logout must stay
      // idempotent for an unknown/expired session, and the login page needs
      // the session query before any cookie exists. Everything else under
      // /api requires a valid session.
      if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) {
        return;
      }
      if (token === undefined || !sessions.verify(token)) {
        throw new AuthError("AUTH_REQUIRED", 401, "login required");
      }
    },
  };
}

/** Login success body — the session travels in the cookie, never JSON. */
export const LOGIN_SUCCESS: AuthLoginSuccess = { status: "ok" };
