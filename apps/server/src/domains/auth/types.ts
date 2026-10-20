/**
 * Auth domain types: single-user access for public deployments. Pure
 * vocabulary only — no transport, no infrastructure, no node: imports.
 */

/** GET /api/auth/session response. */
export interface AuthSessionInfo {
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly expires_at?: string;
}

/** POST /api/auth/login success response. */
export interface AuthLoginSuccess {
  readonly status: "ok";
}
