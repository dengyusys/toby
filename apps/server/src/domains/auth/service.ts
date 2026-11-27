/**
 * Auth service: single-user login over a password the owner sets on the
 * first-run registration page, plus access tokens for the owner's own
 * programs. The clock is injected so tests drive expiry and the registration
 * window; no plaintext password or token is retained.
 */

import { randomUUID } from "node:crypto";
import type {
  AuthConfig,
  TobyConfig,
} from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { readBearerToken, type Principal } from "./access.ts";
import { digestOf } from "./digest.ts";
import { AuthError } from "./errors.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { AuthRepository } from "./repository.ts";
import {
  createSessionRegistry,
  type SessionHandle,
  type SessionRegistry,
} from "./sessions.ts";
import { generateTokenSecret, tokenFingerprint } from "./tokens.ts";
import type {
  AccessTokenRecord,
  AuthLoginSuccess,
  AuthSessionInfo,
} from "./types.ts";

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

/**
 * How long a token's "last used" stamp stays as it is: a busy token costs
 * the request path at most one write per window.
 */
export const TOKEN_LAST_USED_THROTTLE_MS = 5 * 60_000;

/** A token as its creation returns it: the record, and the secret once. */
export interface CreatedToken {
  readonly record: AccessTokenRecord;
  readonly secret: string;
}

export interface AuthService {
  /** Wrong password 401 — including before the owner has registered. */
  login(password: string): Promise<SessionGrant>;
  /**
   * The one-time first run: closed once a password exists
   * (ALREADY_REGISTERED) or the startup window has passed
   * (REGISTRATION_CLOSED). Success starts a session.
   */
  register(password: string): Promise<SessionGrant>;
  /**
   * Changes the password against the current one (wrong current 401) and
   * ends every session, the caller's included.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Idempotent: unknown or missing tokens revoke as no-ops. */
  logout(token: string | undefined): Promise<void>;
  session(token: string | undefined): Promise<AuthSessionInfo>;
  /**
   * Who is calling, for the route guard: the owner's session cookie, or an
   * access token in the Authorization header. A presented token decides on
   * its own — an invalid one is INVALID_TOKEN even beside a valid cookie —
   * so the cookie is consulted only when no token was presented.
   */
  authenticate(input: {
    authorization: string | undefined;
    cookie: string | undefined;
  }): Promise<Principal>;
  createToken(input: { name: string }): Promise<CreatedToken>;
  /** Tokens that are not revoked, newest first. */
  listTokens(): Promise<AccessTokenRecord[]>;
  /**
   * Revoking twice is harmless and answers the record both times; an id that
   * never existed is TOKEN_NOT_FOUND.
   */
  revokeToken(id: string): Promise<AccessTokenRecord>;
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

    async changePassword(currentPassword, newPassword) {
      const stored = await deps.repository.getPasswordHash();
      if (
        typeof currentPassword !== "string" ||
        stored === null ||
        !verifyPassword(currentPassword, stored)
      ) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "wrong password");
      }
      await deps.repository.updatePasswordHash(hashPassword(newPassword));
      // Sessions were granted on the strength of the old password: a stolen
      // one must not outlive the change. Access tokens are the owner's own
      // doing and are revoked one by one.
      sessions.revokeAll();
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

    async authenticate({ authorization, cookie }) {
      const presented = readBearerToken(authorization);
      if (presented !== undefined) {
        const token = await deps.repository.findTokenByDigest(
          digestOf(presented),
        );
        const nowMs = deps.clock();
        // Unknown and revoked read the same from the outside.
        if (token === null || token.revokedAt !== null) {
          throw new AuthError("INVALID_TOKEN", 401, "invalid access token");
        }
        if (
          token.lastUsedAt === null ||
          nowMs - Date.parse(token.lastUsedAt) >= TOKEN_LAST_USED_THROTTLE_MS
        ) {
          await deps.repository.touchToken(
            token.id,
            new Date(nowMs).toISOString(),
          );
        }
        return { kind: "token", tokenId: token.id };
      }
      if (cookie === undefined || !sessions.verify(cookie)) {
        throw new AuthError("AUTH_REQUIRED", 401, "login required");
      }
      return { kind: "session" };
    },

    async createToken({ name }) {
      const secret = generateTokenSecret();
      const { digest, lastFour } = tokenFingerprint(secret);
      const record: AccessTokenRecord = {
        id: randomUUID(),
        name,
        lastFour,
        createdAt: new Date(deps.clock()).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      await deps.repository.insertToken(record, digest);
      return { record, secret };
    },

    listTokens() {
      return deps.repository.listTokens();
    },

    async revokeToken(id) {
      const record = await deps.repository.findToken(id);
      if (record === null) {
        throw new AuthError("TOKEN_NOT_FOUND", 404, "no such access token");
      }
      if (record.revokedAt !== null) {
        return record;
      }
      const revokedAt = new Date(deps.clock()).toISOString();
      await deps.repository.revokeToken(id, revokedAt);
      return { ...record, revokedAt };
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
