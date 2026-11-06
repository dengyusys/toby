/**
 * System domain assembly: constructs the service, registers the routes,
 * nothing else to wire.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Clock } from "../../infrastructure/clock.ts";
import { createSystemService } from "./service.ts";
import { systemRoutes } from "./routes.ts";

export interface SystemPluginOptions {
  clock?: Clock;
}

export function systemPlugin(options: SystemPluginOptions): FastifyPluginAsync {
  const service = createSystemService({ clock: options.clock ?? Date.now });
  return async (app) => {
    await app.register(systemRoutes, { service });
  };
}
