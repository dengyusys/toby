/**
 * Auth domain client: register/login/logout/session. The session token lives
 * in an HttpOnly cookie set by the server; this client never sees or stores it.
 */

import { endpoint, requestJson } from "./request-json.ts";

/** Where the deployment stands; mirrors the server's closed state union. */
export type AuthState = "unregistered" | "unauthenticated" | "authenticated";

/** The closed error-code union, mirroring the server domain's. */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "AUTH_REQUIRED"
  | "ALREADY_REGISTERED"
  | "REGISTRATION_CLOSED";

export interface AuthSessionInfo {
  state: AuthState;
  expires_at?: string;
}

export interface AuthLoginResult {
  status: "ok";
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
}

export function createAuthClient(baseUrl: string): AuthClient {
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
  };
}
