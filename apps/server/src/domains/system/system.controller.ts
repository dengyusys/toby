/**
 * System domain routes as a Nest controller: a pure HTTP shell — every
 * handler is one service call plus the shared envelope, written through
 * the same reply writer so response bytes stay identical. Health is
 * @Public: it is the Docker healthcheck target and carries no data.
 */

import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { Public } from "../../infrastructure/http/public.decorator.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import { SystemService } from "./service.ts";

@Controller("api/system")
export class SystemController {
  constructor(private readonly service: SystemService) {}

  @Public()
  @Get("health")
  health(@Res() reply: FastifyReply): void {
    sendJsonReply(reply, HTTP_STATUS.ok, this.service.health());
  }

  @Get("info")
  info(@Res() reply: FastifyReply): void {
    sendJsonReply(reply, HTTP_STATUS.ok, this.service.info());
  }
}
