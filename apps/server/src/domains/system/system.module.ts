/**
 * System domain Nest module. The house pattern every domain follows:
 * controllers are pure HTTP shells over @Injectable class services,
 * constructor-injected; shared runtime values arrive by token from the
 * global SharedProvidersModule.
 */

import { Module } from "@nestjs/common";
import { SystemService } from "./system.service.ts";
import { SystemController } from "./system.controller.ts";

@Module({
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
