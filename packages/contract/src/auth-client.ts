/**
 * Auth domain client: register/login/logout/session, the password change,
 * and access token management. The session token lives in an HttpOnly cookie
 * set by the server; this client never sees or stores it.
 */

import { endpoint, requestJson } from "./request-json.ts";

/** Where the deployment stands; mirrors the server's closed state union. */
export type AuthState = "unregistered" | "unauthenticated" | "authenticated";

/** What an access token may do; `write` covers `read`. */
export type AuthScope = "read" | "write";

/** The closed error-code union, mirroring the server domain's. */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "ALREADY_REGISTERED"
  | "REGISTRATION_CLOSED"
  | "INSUFFICIENT_SCOPE"
  | "SESSION_REQUIRED"
  | "TOKEN_NOT_FOUND";

export interface AuthSessionInfo {
  state: AuthState;
  expires_at?: string;
}

export interface AuthLoginResult {
  status: "ok";
}

/** An access token on the wire — everything about it but the secret. */
export interface AccessTokenView {
  id: string;
  name: string;
  scopes: AuthScope[];
  last_four: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/** POST /api/auth/tokens body. `scopes` holds exactly one tier. */
export interface AccessTokenCreate {
  name: string;
  scopes: AuthScope[];
  /** ISO time; omitted = never expires. */
  expires_at?: string;
}

/** POST /api/auth/tokens result: the token, and the secret this one time. */
export interface CreatedAccessToken {
  token: AccessTokenView;
  secret: string;
}

/** DELETE /api/auth/tokens/:id result. */
export interface AccessTokenRevocation {
  id: string;
  action: "revoked";
  revoked_at: string;
}

export interface AuthClient {
  /**
   * The one-time first-run registration: succeeds only while no password
   * exists and the server's startup window is still open.
   */
  register(password: string): Promise<AuthLoginResult>;
  login(password: string): Promise<AuthLoginResult>;
  /**
   * Changes the password against the current one. Every session ends with
   * it, the caller's included, so a successful change means logging in again.
   */
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ status: "ok" }>;
  /** Idempotent: logging out while logged out succeeds. */
  logout(): Promise<{ status: "ok" }>;
  session(): Promise<AuthSessionInfo>;
  /**
   * Token management, in every direction: the browser session's business
   * only — an access token itself answers SESSION_REQUIRED.
   */
  listTokens(): Promise<{ tokens: AccessTokenView[] }>;
  createToken(body: AccessTokenCreate): Promise<CreatedAccessToken>;
  revokeToken(id: string): Promise<AccessTokenRevocation>;
}

export function createAuthClient(baseUrl: string): AuthClient {
  const tokens = endpoint(baseUrl, "/api/auth/tokens");
  return {
    register: (password) =>
      requestJson<AuthLoginResult>(endpoint(baseUrl, "/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    login: (password) =>
      requestJson<AuthLoginResult>(endpoint(baseUrl, "/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    changePassword: (currentPassword, newPassword) =>
      requestJson<{ status: "ok" }>(endpoint(baseUrl, "/api/auth/password"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      }),
    logout: () =>
      requestJson<{ status: "ok" }>(endpoint(baseUrl, "/api/auth/logout"), {
        method: "POST",
      }),
    session: () =>
      requestJson<AuthSessionInfo>(endpoint(baseUrl, "/api/auth/session")),
    listTokens: () => requestJson<{ tokens: AccessTokenView[] }>(tokens),
    createToken: (body) =>
      requestJson<CreatedAccessToken>(tokens, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    revokeToken: (id) =>
      requestJson<AccessTokenRevocation>(
        endpoint(baseUrl, `/api/auth/tokens/${encodeURIComponent(id)}`),
        { method: "DELETE" },
      ),
  };
}
