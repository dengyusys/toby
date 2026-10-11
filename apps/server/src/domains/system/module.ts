/**
 * System domain self-assembly: builds the service, binds it into the route
 * plugin, returns the mount descriptor. The composition root registers one
 * line per domain — this is that line for system.
 */

import type { MountedDomain } from "../../infrastructure/http/domain-mount.ts";
import { systemRouter } from "./router.ts";
import { assembleSystemService } from "./service.ts";

export function assembleSystem(): MountedDomain {
  const service = assembleSystemService();
  return {
    name: "system",
    plugin: async (app) => {
      await app.register(systemRouter, { service });
    },
  };
}
