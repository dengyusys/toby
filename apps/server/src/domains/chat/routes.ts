/**
 * Chat routes: a thin HTTP shell, one service call per handler. Body
 * envelopes are checked here with inline schemas; everything inside
 * is the domain's call. Every route follows the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import type { ChatService } from "./service.ts";

export interface ChatRoutesOptions {
  service: ChatService;
}

const SEND_BODY_SCHEMA = z.object({ text: z.string() }).strict();
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
  app.post<{ Body: SendBody }>("/api/chat/messages", (request) =>
    service.sendMessage(parseBody(SEND_BODY_SCHEMA, request).text, request.ip),
  );

  app.get("/api/chat/sessions", () => service.listSessions());

  app.get<MessagesQuery & SessionParams>(
    "/api/chat/sessions/:id/messages",
    (request) =>
      service.listMessages(request.params.id, {
        limit: first(request.query.limit),
      }),
  );
};
