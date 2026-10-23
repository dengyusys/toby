/**
 * System domain Nest module: registers the walking-skeleton controller and
 * provides the assembled service. Establishes the house pattern every
 * domain follows — controllers stay pure HTTP shells over the same
 * service layer, wired through injection tokens (services are interfaces
 * plus assemble functions, not classes).
 */

import { Module } from "@nestjs/common";
import { assembleSystemService } from "./service.ts";
import { SystemController } from "./system.controller.ts";
import { SYSTEM_SERVICE } from "./tokens.ts";

@Module({
  controllers: [SystemController],
  providers: [
    { provide: SYSTEM_SERVICE, useFactory: () => assembleSystemService() },
  ],
})
export class SystemModule {}
