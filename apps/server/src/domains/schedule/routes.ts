/**
 * Schedule routes: a thin HTTP shell, one service call per handler. The
 * envelope-only body check happens here against schema.ts (so unknown
 * keys answer BAD_REQUEST); everything inside is the domain's call and
 * answers the resource's own closed error code. Every route follows the
 * session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import {
  ENTRY_PUT_SCHEMA,
  ITEM_BODY_SCHEMA,
  ITEM_PATCH_SCHEMA,
  VIEW_BODY_SCHEMA,
  VIEW_PATCH_SCHEMA,
} from "./schema.ts";
import type { ScheduleService } from "./service.ts";

export interface ScheduleRoutesOptions {
  service: ScheduleService;
}

/** A path id; the domain validates what it may be. */
interface IdParams {
  Params: { id: string };
}

export const scheduleRoutes: FastifyPluginAsync<ScheduleRoutesOptions> = async (
  app,
  { service },
) => {
  // Items: the board's tracked rows, listed in creation order.
  app.get("/api/schedule/items", () => service.listItems());
  app.post("/api/schedule/items", (request) =>
    service.createItem(parseBody(ITEM_BODY_SCHEMA, request)),
  );
  app.patch<IdParams>("/api/schedule/items/:id", (request) =>
    service.updateItem(
      request.params.id,
      parseBody(ITEM_PATCH_SCHEMA, request),
    ),
  );
  app.delete<IdParams>("/api/schedule/items/:id", (request) =>
    service.deleteItem(request.params.id),
  );

  // Entries: create-or-update by natural key; the range list is inclusive.
  app.put("/api/schedule/entries", (request) =>
    service.putEntry(parseBody(ENTRY_PUT_SCHEMA, request)),
  );
  app.delete<IdParams>("/api/schedule/entries/:id", (request) =>
    service.deleteEntry(request.params.id),
  );

  // A repeated `?from=`/`?to=` arrives as an array: not a date.
  app.get<{
    Querystring: { from?: string | string[]; to?: string | string[] };
  }>("/api/schedule", (request) => {
    const { from, to } = request.query;
    return service.listEntries(
      Array.isArray(from) ? undefined : from,
      Array.isArray(to) ? undefined : to,
    );
  });

  // Saved views: named queries stored in their own table.
  app.get("/api/schedule/views", () => service.listViews());
  app.post("/api/schedule/views", (request) =>
    service.createView(parseBody(VIEW_BODY_SCHEMA, request)),
  );
  app.patch<IdParams>("/api/schedule/views/:id", (request) =>
    service.updateView(
      request.params.id,
      parseBody(VIEW_PATCH_SCHEMA, request),
    ),
  );
  app.delete<IdParams>("/api/schedule/views/:id", (request) =>
    service.deleteView(request.params.id),
  );
};
