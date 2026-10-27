/**
 * Ledger domain routes as a Nest controller: a thin HTTP shell — every
 * handler is one service call plus the shared envelope; every failure is a
 * domain-shaped error caught by the global exception filter.
 */

import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import { LedgerService } from "./service.ts";

@Controller("api/ledger")
export class LedgerController {
  constructor(private readonly service: LedgerService) {}

  @Get("months")
  async months(@Res() reply: FastifyReply): Promise<void> {
    sendJsonReply(reply, HTTP_STATUS.ok, await this.service.months());
  }

  @Get("transactions")
  async transactions(
    @Query("month") month: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendJsonReply(reply, HTTP_STATUS.ok, await this.service.monthReport(month));
  }

  @Post("proposals")
  async createProposal(
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendJsonReply(
      reply,
      HTTP_STATUS.ok,
      await this.service.createProposal(body),
    );
  }

  @Post("proposals/:id/commit")
  async commit(
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendJsonReply(reply, HTTP_STATUS.ok, await this.service.commit(id));
  }

  @Post("proposals/:id/cancel")
  async cancel(
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendJsonReply(reply, HTTP_STATUS.ok, await this.service.cancel(id));
  }
}
