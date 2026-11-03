/**
 * Ledger routes: a thin HTTP shell, one service call per handler. The
 * envelope-only body check happens here (dto/); everything inside is the
 * domain's call. Every route follows the session guard.
 */

import type { FastifyPluginAsync } from "fastify";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import { PROPOSAL_BODY_SCHEMA } from "./dto/create-proposal.dto.ts";
import type { LedgerService } from "./ledger.service.ts";

export interface LedgerRoutesOptions {
  service: LedgerService;
}

/** A path id; the domain validates what it may be. */
interface IdParams {
  Params: { id: string };
}

export const ledgerRoutes: FastifyPluginAsync<LedgerRoutesOptions> = async (
  app,
  { service },
) => {
  app.get("/api/ledger/months", () => service.months());

  // A repeated `?month=` arrives as an array: not a month, so INVALID_MONTH.
  app.get<{ Querystring: { month?: string | string[] } }>(
    "/api/ledger/transactions",
    (request) => {
      const { month } = request.query;
      return service.monthReport(Array.isArray(month) ? undefined : month);
    },
  );

  app.post("/api/ledger/proposals", (request) =>
    service.createProposal(parseBody(PROPOSAL_BODY_SCHEMA, request)),
  );

  app.post<IdParams>("/api/ledger/proposals/:id/commit", (request) =>
    service.commit(request.params.id),
  );

  app.post<IdParams>("/api/ledger/proposals/:id/cancel", (request) =>
    service.cancel(request.params.id),
  );

  app.delete<IdParams>("/api/ledger/transactions/:id", (request) =>
    service.deleteTransaction(request.params.id),
  );
};
