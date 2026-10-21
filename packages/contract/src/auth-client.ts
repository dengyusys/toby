/**
 * Auth domain client: login/logout/session. The session token lives in an
 * HttpOnly cookie set by the server; this client never sees or stores it.
 */

import { endpoint, requestJson } from "./request-json.ts";

export interface AuthSessionInfo {
  enabled: boolean;
  authenticated: boolean;
  expires_at?: string;
}

export interface AuthLoginResult {
  status: "ok";
}

export interface AuthClient {
  login(password: string): Promise<AuthLoginResult>;
  /** Idempotent: logging out while logged out succeeds. */
  logout(): Promise<{ status: "ok" }>;
  session(): Promise<AuthSessionInfo>;
}

export function createAuthClient(baseUrl: string): AuthClient {
  return {
    login: (password) =>
      requestJson<AuthLoginResult>(endpoint(baseUrl, "/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    logout: () =>
      requestJson<{ status: "ok" }>(endpoint(baseUrl, "/api/auth/logout"), {
        method: "POST",
      }),
    session: () =>
      requestJson<AuthSessionInfo>(endpoint(baseUrl, "/api/auth/session")),
  };
}
