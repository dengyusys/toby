/**
 * Memory routes: a thin HTTP shell over the service. The page is a
 * read-only raw view of MEMORY.md, so the only writes left here are the
 * off-record toggle and the human maintenance reset. Every route follows
 * the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import { MEMORY_OFF_RECORD_BODY_SCHEMA } from "./schema.ts";
import type { MemoryService } from "./types.ts";

export interface MemoryRoutesOptions {
  service: MemoryService;
}

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (
  app,
  { service },
) => {
  // The page's raw view of MEMORY.md: the file's exact bytes, never a
  // re-serialization and never a repair of a corrupt file.
  app.get("/api/memory/file", async (_request, reply) => {
    const markdown = await service.readFile();
    void reply.type("text/markdown; charset=utf-8");
    return markdown;
  });

  app.get("/api/memory/off-record", () => ({
    on: service.getOffRecord().on,
  }));

  app.post("/api/memory/off-record", (request) => {
    const body = parseBody(MEMORY_OFF_RECORD_BODY_SCHEMA, request);
    service.setOffRecord(body.on);
    return { on: service.getOffRecord().on };
  });

  // Human maintenance: discard the whole book — one atomic replace of an
  // explicit empty file, corrupt or not. Not gated by off-record: that
  // gate guards the AI tools, which this route never touches.
  app.post("/api/memory/reset", () => service.resetMemory());
};
