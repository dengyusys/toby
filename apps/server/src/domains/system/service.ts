/**
 * System domain service: the tiny use-case layer. Health needs nothing;
 * info assembles the runtime identity (version + start time + uptime).
 * The clock is injected by token so tests pin and advance time.
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
