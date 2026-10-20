/**
 * Ledger domain routes: a thin HTTP shell — every handler is one service
 * call plus the shared envelope; every failure is a domain-shaped error
 * caught by the unified error boundary.
 */

import type { FastifyPluginAsync } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import type { LedgerService } from "./service.ts";

export interface LedgerRouterDeps {
  service: LedgerService;
}

export const ledgerRouter: FastifyPluginAsync<LedgerRouterDeps> = async (
  app,
  options,
) => {
  const { service } = options;

  app.get("/api/ledger/months", async (_request, reply) => {
    sendJsonReply(reply, HTTP_STATUS.ok, await service.months());
  });

  app.get("/api/ledger/transactions", async (request, reply) => {
    const { month } = request.query as { month?: string };
    sendJsonReply(reply, HTTP_STATUS.ok, await service.monthReport(month));
  });

  app.post("/api/ledger/proposals", async (request, reply) => {
    sendJsonReply(
      reply,
      HTTP_STATUS.ok,
      await service.createProposal(request.body),
    );
  });

  app.post("/api/ledger/proposals/:id/commit", async (request, reply) => {
    const { id } = request.params as { id: string };
    sendJsonReply(reply, HTTP_STATUS.ok, await service.commit(id));
  });

  app.post("/api/ledger/proposals/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    sendJsonReply(reply, HTTP_STATUS.ok, await service.cancel(id));
  });
};
