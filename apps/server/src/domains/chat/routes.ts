/**
 * Chat routes: body envelopes are checked here with inline schemas,
 * everything inside is the domain's call. Every route follows the session
 * guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import { TIME_ZONE_SCHEMA } from "../../infrastructure/local-date.ts";
import type { ChatService } from "./service.ts";

export interface ChatRoutesOptions {
  service: ChatService;
}

/** One send: the sentence, plus where the writer is — their browser's zone. */
const SEND_BODY_SCHEMA = z
  .object({
    text: z.string(),
    time_zone: TIME_ZONE_SCHEMA.optional(),
  })
  .strict();
export type SendBody = z.infer<typeof SEND_BODY_SCHEMA>;

interface SessionParams {
  Params: { id: string };
}

interface MessagesQuery {
  Querystring: { limit?: string | string[] };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (
  app,
  { service },
) => {
  app.post<{ Body: SendBody }>("/api/chat/messages", (request) => {
    const { text, time_zone } = parseBody(SEND_BODY_SCHEMA, request);
    return service.sendMessage(text, request.ip, time_zone);
  });

  app.get("/api/chat/sessions", () => service.listSessions());

  app.get<MessagesQuery & SessionParams>(
    "/api/chat/sessions/:id/messages",
    (request) =>
      service.listMessages(request.params.id, {
        limit: first(request.query.limit),
      }),
  );
};
