/**
 * System domain routes as a Nest controller: a pure HTTP shell — every
 * handler is one service call plus the shared envelope, written through
 * the same reply writer so response bytes stay identical.
 */

import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import type { SystemService } from "./service.ts";
import { SYSTEM_SERVICE } from "./tokens.ts";

@Controller("api/system")
export class SystemController {
  // Property injection: explicit @Inject tokens work under both the tsc build
  // and vitest's esbuild transform (no emitDecoratorMetadata needed).
  @Inject(SYSTEM_SERVICE)
  private readonly service!: SystemService;

  @Get("health")
  health(@Res() reply: FastifyReply): void {
    sendJsonReply(reply, HTTP_STATUS.ok, this.service.health());
  }

  @Get("info")
  info(@Res() reply: FastifyReply): void {
    sendJsonReply(reply, HTTP_STATUS.ok, this.service.info());
  }
}
