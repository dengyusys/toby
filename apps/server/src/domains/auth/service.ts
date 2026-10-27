/**
 * Auth service: single-user login over a configured password hash. The
 * clock is injected so tests drive expiry and the rate-limit window. No
 * plaintext passwords or tokens are retained or logged.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  AuthConfig,
  TobyConfig,
} from "../../infrastructure/config/config.ts";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import {
  CLOCK,
  TOBY_CONFIG,
  type Clock,
} from "../../infrastructure/providers/shared-tokens.ts";
import { AuthError } from "./errors.ts";
import { verifyPassword } from "./password.ts";
import { createLoginRateLimiter, type LoginRateLimiter } from "./rate-limit.ts";
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

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly config: AuthConfig;
  private readonly sessions: SessionRegistry;
  private readonly limiter: LoginRateLimiter;
  private readonly logger = new Logger(AuthService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(TOBY_CONFIG) config: TobyConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.config = config.auth;
    this.sessions = createSessionRegistry({ now: this.clock });
    this.limiter = createLoginRateLimiter({
      now: this.clock,
      windowMs: config.auth.rateLimitWindowMs,
      max: config.auth.rateLimitMax,
    });
  }

  /** Wrong password 401, over the limit 429, disabled 400. */
  async login(password: string, ip: string): Promise<SessionGrant> {
    if (!this.config.enabled) {
      throw new AuthError(
        "AUTH_DISABLED",
        HTTP_STATUS.badRequest,
        "authentication is not configured (TOBY_AUTH_PASSWORD_HASH is unset)",
      );
    }
    const decision = this.limiter.attempt(ip);
    if (!decision.allowed) {
      // The IP (never the password) makes lockouts traceable in logs.
      this.logger.warn("login rate limited", { ip });
      throw new AuthError(
        "RATE_LIMITED",
        HTTP_STATUS.tooManyRequests,
        "too many login attempts",
        decision.retryAfterSeconds,
      );
    }
    if (
      typeof password !== "string" ||
      !verifyPassword(password, this.config.passwordHash)
    ) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        HTTP_STATUS.unauthorized,
        "wrong password",
      );
    }
    return this.sessions.create(this.config.sessionTtlMs);
  }

  /** Idempotent: unknown or missing tokens revoke as no-ops. */
  async logout(token: string | undefined): Promise<void> {
    if (token !== undefined) {
      this.sessions.revoke(token);
    }
  }

  session(token: string | undefined): AuthSessionInfo {
    if (!this.config.enabled) {
      return { enabled: false, authenticated: false };
    }
    const expiresAtMs =
      token === undefined ? undefined : this.sessions.expiryOf(token);
    if (expiresAtMs === undefined) {
      return { enabled: true, authenticated: false };
    }
    return {
      enabled: true,
      authenticated: true,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Session check for the route guard. Exemptions are decided by route
   * metadata (@Public()), not by parsing the request URL — the URL string
   * never enters this decision, so encoded-path tricks cannot dodge it.
   * No-op while authentication is disabled.
   */
  requireSession(token: string | undefined): void {
    if (!this.config.enabled) {
      return;
    }
    if (token === undefined || !this.sessions.verify(token)) {
      throw new AuthError(
        "AUTH_REQUIRED",
        HTTP_STATUS.unauthorized,
        "login required",
      );
    }
  }

  /** Prune expired sessions; bounded memory is the sweeper's only job. */
  private sweepSessions(): void {
    this.sessions.sweep();
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweepSessions();
    }, SESSION_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}

/** Login success body — the session travels in the cookie, never JSON. */
export const LOGIN_SUCCESS: AuthLoginSuccess = { status: "ok" };
