/**
 * System domain service: the tiny use-case layer. Health needs nothing;
 * info assembles the runtime identity (version + start time + uptime).
 * Dependencies are injected so tests can pin the clock.
 */

import type { SystemHealth, SystemInfo } from "./types.ts";
import { readServerVersion } from "./version.ts";

export interface SystemService {
  health(): SystemHealth;
  info(): SystemInfo;
}

export interface SystemServiceDeps {
  version?: string;
  startedAt?: Date;
  now?: () => number;
}

export function assembleSystemService(
  deps: SystemServiceDeps = {},
): SystemService {
  const version = deps.version ?? readServerVersion();
  const startedAt = deps.startedAt ?? new Date();
  const now = deps.now ?? Date.now;
  return {
    health: () => ({ status: "ok" }),
    info: () => ({
      name: "toby",
      version,
      node: process.versions.node,
      started_at: startedAt.toISOString(),
      uptime_seconds: Math.floor((now() - startedAt.getTime()) / 1000),
    }),
  };
}
