/**
 * Auth domain types: single-user access for public deployments. Pure
 * vocabulary only — no transport, no infrastructure, no node: imports.
 * Response shapes are mirrored by hand in packages/contract/src — change
 * both sides together.
 */

import type { Scope } from "./access.ts";

/**
 * Where the deployment stands: no password yet (the registration page is the
 * only way forward), a password but no session, or a live session.
 */
export type AuthState = "unregistered" | "unauthenticated" | "authenticated";

/** GET /api/auth/session response. */
export interface AuthSessionInfo {
  readonly state: AuthState;
  readonly expires_at?: string;
}

/** POST /api/auth/register and POST /api/auth/login success response. */
export interface AuthLoginSuccess {
  readonly status: "ok";
}

/** An access token as the server keeps it — never the secret itself. */
export interface AccessTokenRecord {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
  /** The visible tail shown in the list. */
  readonly lastFour: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** ISO time after which the token answers 401; null = never. */
  readonly expiresAt: string | null;
  /** ISO time of the revocation; null while the token is live. */
  readonly revokedAt: string | null;
}
