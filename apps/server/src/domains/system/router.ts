/**
 * System domain routes: the walking skeleton of the server. A pure HTTP
 * shell — every handler is one service call plus the shared envelope.
 */

import type { FastifyPluginAsync } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import type { SystemService } from "./service.ts";

export interface SystemRouterDeps {
  service: SystemService;
}

export const systemRouter: FastifyPluginAsync<SystemRouterDeps> = async (
  app,
  options,
) => {
  app.get("/api/system/health", async (_request, reply) => {
    sendJsonReply(reply, HTTP_STATUS.ok, options.service.health());
  });

  app.get("/api/system/info", async (_request, reply) => {
    sendJsonReply(reply, HTTP_STATUS.ok, options.service.info());
  });
};
