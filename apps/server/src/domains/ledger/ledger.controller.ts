/** Ledger routes: a thin HTTP shell, one service call per handler. */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  PROPOSAL_BODY_SCHEMA,
  type ProposalBody,
} from "./dto/create-proposal.dto.ts";
import { LedgerService, type LedgerProposalResult } from "./ledger.service.ts";
import type {
  LedgerCancelResult,
  LedgerCommitResult,
  LedgerMonthReport,
} from "./types.ts";

@Controller("api/ledger")
export class LedgerController {
  constructor(private readonly service: LedgerService) {}

  @Get("months")
  months(): Promise<{ months: readonly string[] }> {
    return this.service.months();
  }

  @Get("transactions")
  transactions(
    @Query("month") month: string | undefined,
  ): Promise<LedgerMonthReport> {
    return this.service.monthReport(month);
  }

  @Post("proposals")
  @HttpCode(HttpStatus.OK)
  createProposal(
    @Body({ schema: PROPOSAL_BODY_SCHEMA }) body: ProposalBody,
  ): Promise<LedgerProposalResult> {
    return this.service.createProposal(body);
  }

  @Post("proposals/:id/commit")
  @HttpCode(HttpStatus.OK)
  commit(@Param("id") id: string): Promise<LedgerCommitResult> {
    return this.service.commit(id);
  }

  @Post("proposals/:id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id") id: string): Promise<LedgerCancelResult> {
    return this.service.cancel(id);
  }
}
