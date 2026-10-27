/**
 * The global SharedProvidersModule: carries the resolved TobyConfig and
 * the clock into the DI container as value tokens. Config is resolved
 * once in the composition root (fail-fast, before Nest starts) — see
 * docs/decisions/idiomatic-nest-services.md for why the app does not
 * use @nestjs/config on top of that.
 */

import { Module, type DynamicModule } from "@nestjs/common";
import type { TobyConfig } from "../config/config.ts";
import {
  CLOCK,
  TOBY_CONFIG,
  type Clock,
  type SharedProviderOptions,
} from "./shared-tokens.ts";

@Module({})
export class SharedProvidersModule {
  static forRoot(
    config: TobyConfig,
    options: SharedProviderOptions = {},
  ): DynamicModule {
    const clock: Clock = options.clock ?? Date.now;
    return {
      global: true,
      module: SharedProvidersModule,
      providers: [
        { provide: TOBY_CONFIG, useValue: config },
        { provide: CLOCK, useValue: clock },
      ],
      exports: [TOBY_CONFIG, CLOCK],
    };
  }
}
