/**
 * Auth domain Nest module: the service (owning the session sweeper) and
 * the session guard as @Injectable classes. Importing the auth module is
 * what makes authentication available to the composition root, which
 * installs the guard globally. (APP_GUARD registration is not used: it is
 * broken under the ESM test tooling — see
 * docs/decisions/idiomatic-nest-services.md.)
 */

import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.ts";
import { AuthService } from "./service.ts";
import { SessionGuard } from "./session.guard.ts";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
