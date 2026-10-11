/**
 * System domain self-assembly: builds the route plugin with its own
 * dependencies closed over and returns the mount descriptor. The
 * composition root registers one line per domain — this is that line
 * for system.
 */

import type { MountedDomain } from "../../infrastructure/http/domain-mount.ts";
import { systemRouter } from "./router.ts";

export function assembleSystem(): MountedDomain {
  const startedAt = new Date();
  return {
    name: "system",
    plugin: async (app) => {
      await app.register(systemRouter, { startedAt });
    },
  };
}
