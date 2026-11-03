/**
 * Traces domain assembly: mounts the SSE stream endpoint over the shared
 * trace bus. The bus is created once in the composition root and handed to
 * both the AI runtime (which reports into it) and this domain (which
 * streams it out) — the cross-domain wiring the boundary rules reserve to
 * the composition root. Stateless: nothing to store, nothing to close.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TraceBus } from "../../infrastructure/trace/types.ts";
import { tracesRoutes } from "./traces.routes.ts";

export interface TracesPluginOptions {
  bus: TraceBus;
}

export function tracesPlugin(options: TracesPluginOptions): FastifyPluginAsync {
  return async (app) => {
    await app.register(tracesRoutes, { bus: options.bus });
  };
}
