/**
 * System domain client: the liveness and build-info endpoints.
 */

import { endpoint, requestJson } from "./request-json.ts";

export interface SystemHealth {
  status: "ok";
}

export interface SystemInfo {
  name: string;
  version: string;
  node: string;
  started_at: string;
  uptime_seconds: number;
}

export interface SystemClient {
  health(): Promise<SystemHealth>;
  info(): Promise<SystemInfo>;
}

export function createSystemClient(baseUrl: string): SystemClient {
  return {
    health: () =>
      requestJson<SystemHealth>(endpoint(baseUrl, "/api/system/health")),
    info: () => requestJson<SystemInfo>(endpoint(baseUrl, "/api/system/info")),
  };
}
