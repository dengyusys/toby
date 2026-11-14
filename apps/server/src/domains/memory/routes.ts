/**
 * Memory routes: a thin HTTP shell, one service call per handler. Write
 * results that are refusals (ambiguity, duplicate, nothing matched) map
 * onto the domain's wire codes here; everything else is the service's
 * answer. Every route follows the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import { MemoryRequestError } from "./errors.ts";
import {
  MEMORY_ENTRY_BODY_SCHEMA,
  MEMORY_FORGET_BODY_SCHEMA,
  MEMORY_OFF_RECORD_BODY_SCHEMA,
  MEMORY_REPLACE_BODY_SCHEMA,
} from "./schema.ts";
import type { MemoryService } from "./types.ts";
import type { MemoryWriteResult } from "./types.ts";

export interface MemoryRoutesOptions {
  service: MemoryService;
}

/**
 * A receipt, or the refusal rendered as its wire error: several keyword
 * hits are a conflict that names the candidates, an exact duplicate is a
 * conflict, a forget that matched nothing is honestly a 404.
 */
function receiptOrThrow(result: MemoryWriteResult) {
  switch (result.kind) {
    case "receipt":
      return result.receipt;
    case "ambiguous":
      throw new MemoryRequestError(
        "AMBIGUOUS_ENTRY",
        409,
        `匹配到 ${result.candidates.length} 条记忆，请说得更具体: ${result.candidates.join("；")}`,
      );
    case "already-remembered":
      throw new MemoryRequestError(
        "DUPLICATE_ENTRY",
        409,
        `已经记住了: ${result.line}`,
      );
    case "nothing-matched":
      throw new MemoryRequestError(
        "ENTRY_NOT_FOUND",
        404,
        "没有找到匹配的记忆",
      );
  }
}

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (
  app,
  { service },
) => {
  // The page: every entry, 约定 → 关于我 → 人物, expiry resolved.
  app.get("/api/memory", () => service.list());

  app.post("/api/memory/entries", async (request) =>
    receiptOrThrow(
      await service.remember(parseBody(MEMORY_ENTRY_BODY_SCHEMA, request)),
    ),
  );

  app.post("/api/memory/entry/replace", async (request) => {
    const body = parseBody(MEMORY_REPLACE_BODY_SCHEMA, request);
    return receiptOrThrow(await service.replaceExact(body.current, body.next));
  });

  app.post("/api/memory/entry/forget", async (request) =>
    receiptOrThrow(
      await service.forget(
        parseBody(MEMORY_FORGET_BODY_SCHEMA, request).keyword,
      ),
    ),
  );

  // The on-demand .md snapshot: never written to disk anywhere else.
  app.get("/api/memory/export", async (_request, reply) => {
    const markdown = await service.exportMarkdown();
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
};
