/**
 * Traces assembly: mounts the SSE stream endpoint over the shared trace bus,
 * which the composition root creates once for both the AI runtime and this
 * domain to share. Stateless: nothing to store, nothing to close.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TraceBus } from "../../infrastructure/trace/types.ts";
import { tracesRoutes } from "./routes.ts";

export interface TracesPluginOptions {
  bus: TraceBus;
}

export function tracesPlugin(options: TracesPluginOptions): FastifyPluginAsync {
  return async (app) => {
    await app.register(tracesRoutes, { bus: options.bus });
  };
}
