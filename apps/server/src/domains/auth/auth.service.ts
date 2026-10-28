/**
 * Auth service: single-user login over a configured password hash. The clock is
 * injected so tests drive expiry; no plaintext password or token is retained.
 */

import {
  Inject,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  AuthConfig,
  TobyConfig,
} from "../../infrastructure/config/config.ts";
import {
  CLOCK,
  TOBY_CONFIG,
  type Clock,
} from "../../infrastructure/providers/shared-tokens.ts";
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

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly config: AuthConfig;
  private readonly sessions: SessionRegistry;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(TOBY_CONFIG) config: TobyConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.config = config.auth;
    this.sessions = createSessionRegistry({ now: this.clock });
  }

  /** Wrong password 401, disabled 400 (429 comes from the route's guard). */
  async login(password: string): Promise<SessionGrant> {
    if (!this.config.enabled) {
      throw new AuthError(
        "AUTH_DISABLED",
        HttpStatus.BAD_REQUEST,
        "authentication is not configured (TOBY_AUTH_PASSWORD_HASH is unset)",
      );
    }
    if (
      typeof password !== "string" ||
      !verifyPassword(password, this.config.passwordHash)
    ) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        HttpStatus.UNAUTHORIZED,
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
        HttpStatus.UNAUTHORIZED,
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
