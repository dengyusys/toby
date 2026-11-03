/**
 * Traces domain routes: the one SSE endpoint streaming AI-run events to the
 * web monitor (docs/features/traces.md). Session-guarded like every /api
 * route — transcripts are personal data, so no public opt-out.
 */

import type { FastifyPluginAsync } from "fastify";
import { openEventStream } from "../../infrastructure/http/sse.ts";
import type { TraceBus } from "../../infrastructure/trace/types.ts";

export interface TracesRouteOptions {
  bus: TraceBus;
}

export const tracesRoutes: FastifyPluginAsync<TracesRouteOptions> = async (
  app,
  options,
) => {
  app.get("/api/traces/stream", (_request, reply) => {
    const stream = openEventStream(reply);
    const unsubscribe = options.bus.subscribe((event) => {
      stream.send("trace", event);
    });
    stream.onClose(unsubscribe);
    // Hijacked: the reply's life is the stream's, nothing to return.
  });
};
