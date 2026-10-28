/**
 * The root module: cross-domain wiring happens only here. Config arrives
 * through the global `SharedProvidersModule`.
 */

import { Module } from "@nestjs/common";
import { AuthModule } from "./domains/auth/auth.module.ts";
import { LedgerModule } from "./domains/ledger/ledger.module.ts";
import { SystemModule } from "./domains/system/system.module.ts";
import { HttpModule } from "./infrastructure/http/http.module.ts";
import { SharedProvidersModule } from "./infrastructure/providers/shared-providers.module.ts";

@Module({
  imports: [
    SharedProvidersModule.forRoot(),
    HttpModule,
    SystemModule,
    LedgerModule,
    AuthModule,
  ],
})
export class AppModule {}
