/**
 * Auth domain types: single-user access for public deployments. Pure
 * vocabulary only — no transport, no infrastructure, no node: imports.
 * Response shapes are mirrored by hand in packages/contract/src — change
 * both sides together.
 */

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
