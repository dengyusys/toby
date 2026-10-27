/**
 * The application module factory. Config is resolved once in main (or the
 * test fixture) before anything Nest runs — fail-fast stays ahead of the
 * DI container — and enters the container through the global
 * SharedProvidersModule; the three domain modules then assemble purely
 * through DI. The root module must be a decorated class (a plain
 * DynamicModule object as the NestFactory root scans providers but skips
 * route registration), hence the factory: the decorator is applied where
 * the runtime values are already in scope. Cross-domain wiring happens
 * only here and in main.ts.
 */

import { Module, type Type } from "@nestjs/common";
import { AuthModule } from "./domains/auth/auth.module.ts";
import { LedgerModule } from "./domains/ledger/ledger.module.ts";
import { SystemModule } from "./domains/system/system.module.ts";
import type { TobyConfig } from "./infrastructure/config/config.ts";
import { SharedProvidersModule } from "./infrastructure/providers/shared-providers.module.ts";

export function createAppModule(config: TobyConfig): Type<unknown> {
  @Module({
    imports: [
      SharedProvidersModule.forRoot(config),
      SystemModule,
      LedgerModule,
      AuthModule,
    ],
  })
  class AppModule {}
  return AppModule;
}
