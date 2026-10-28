/**
 * System use cases: a liveness constant and the runtime identity (version,
 * start time, uptime). The clock is injected so tests pin time.
 */

import { Inject, Injectable } from "@nestjs/common";
import {
  CLOCK,
  type Clock,
} from "../../infrastructure/providers/shared-tokens.ts";
import type { SystemHealth, SystemInfo } from "./types.ts";
import { readServerVersion } from "./version.ts";

@Injectable()
export class SystemService {
  private readonly version: string;
  private readonly startedAtMs: number;

  constructor(@Inject(CLOCK) private readonly clock: Clock) {
    this.version = readServerVersion();
    this.startedAtMs = this.clock();
  }

  /** Liveness: the process answers. Nothing is probed any further. */
  health(): SystemHealth {
    return { status: "ok" };
  }

  info(): SystemInfo {
    return {
      name: "toby",
      version: this.version,
      node: process.versions.node,
      started_at: new Date(this.startedAtMs).toISOString(),
      uptime_seconds: Math.floor((this.clock() - this.startedAtMs) / 1000),
    };
  }
}
