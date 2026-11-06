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

const OUTCOME_BODY_SCHEMA = z.object({ outcome: z.string().min(1) }).strict();

interface SessionParams {
  Params: { id: string };
}

interface TurnParams {
  Params: { id: string };
}

interface MessagesQuery {
  Querystring: { limit?: string | string[]; before?: string | string[] };
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

  app.post("/api/chat/sessions", () => service.createSession());

  app.get<MessagesQuery & SessionParams>(
    "/api/chat/sessions/:id/messages",
    (request) =>
      service.listMessages(request.params.id, {
        limit: first(request.query.limit),
        before: first(request.query.before),
      }),
  );

  app.delete<SessionParams>("/api/chat/sessions/:id", (request) =>
    service.deleteSession(request.params.id),
  );

  app.post<TurnParams>("/api/chat/messages/:id/outcome", (request) =>
    service.reportOutcome(
      request.params.id,
      parseBody(OUTCOME_BODY_SCHEMA, request).outcome,
    ),
  );
};
