/**
 * System domain types. This file stays pure: no fastify, no infrastructure,
 * no node: imports — domain types are transport-free.
 */

/** GET /api/system/info response shape. */
export interface SystemInfo {
  name: string;
  version: string;
  node: string;
  started_at: string;
  uptime_seconds: number;
}

/** GET /api/system/health response shape. */
export interface SystemHealth {
  status: "ok";
}
