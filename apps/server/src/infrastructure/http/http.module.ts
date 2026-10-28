/**
 * The HTTP enhancers every application assembled from this module gets: the
 * global filter, the Standard Schema pipe, no-store, and the SPA roots. Domains
 * never import it — the composition root and the test fixture do.
 */

import {
  Module,
  StandardSchemaValidationPipe,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { HttpExceptionFilter } from "./exception-filter.ts";
import { NoStoreMiddleware } from "./no-store.middleware.ts";
import { StaticAssetsProvider } from "./static-assets.ts";

@Module({
  providers: [
    StaticAssetsProvider,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(NoStoreMiddleware).forRoutes("*");
  }
}
