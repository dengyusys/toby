/**
 * System use cases: a liveness constant and the runtime identity (version,
 * start time, uptime). The clock is injected so tests pin time.
 */

import type { Clock } from "../../infrastructure/clock.ts";
import type { SystemHealth, SystemInfo } from "./types.ts";
import { readServerVersion } from "./version.ts";

export interface SystemService {
  /** Liveness: the process answers. Nothing is probed any further. */
  health(): SystemHealth;
  info(): SystemInfo;
}

export function createSystemService(deps: { clock: Clock }): SystemService {
  const version = readServerVersion();
  const startedAtMs = deps.clock();
  return {
    health() {
      return { status: "ok" };
    },
    info() {
      return {
        name: "toby",
        version,
        node: process.versions.node,
        started_at: new Date(startedAtMs).toISOString(),
        uptime_seconds: Math.floor((deps.clock() - startedAtMs) / 1000),
      };
    },
  };
}
