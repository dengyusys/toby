/**
 * System routes: health is public (the Docker healthcheck must answer
 * without a session); info follows the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import type { SystemService } from "./service.ts";

export interface SystemRoutesOptions {
  service: SystemService;
}

export const systemRoutes: FastifyPluginAsync<SystemRoutesOptions> = async (
  app,
  { service },
) => {
  app.get("/api/system/health", { config: { public: true } }, () =>
    service.health(),
  );
  app.get("/api/system/info", () => service.info());
};
