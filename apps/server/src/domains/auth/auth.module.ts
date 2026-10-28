/** Auth module: the service and the session guard, global via `APP_GUARD`. */

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.ts";
import { AuthService } from "./auth.service.ts";
import { SessionGuard } from "./session.guard.ts";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AuthModule {}
