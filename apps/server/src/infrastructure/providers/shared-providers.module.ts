/**
 * Global values every module may inject: the resolved config and the clock.
 * Config is resolved inside the container, so any env problem fails
 * `NestFactory.create`; tests override the token instead of touching env.
 */

import { Module, type DynamicModule } from "@nestjs/common";
import { resolveConfig } from "../config/config.ts";
import { CLOCK, TOBY_CONFIG, type Clock } from "./shared-tokens.ts";

@Module({})
export class SharedProvidersModule {
  static forRoot(): DynamicModule {
    const clock: Clock = Date.now;
    return {
      global: true,
      module: SharedProvidersModule,
      providers: [
        { provide: TOBY_CONFIG, useFactory: resolveConfig },
        { provide: CLOCK, useValue: clock },
      ],
      exports: [TOBY_CONFIG, CLOCK],
    };
  }
}
