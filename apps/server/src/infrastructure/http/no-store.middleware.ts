/**
 * `no-store` on every response. Module middleware runs before the SPA roots are
 * mounted (`onModuleInit`), so static files carry it too.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NodeResponse } from "@nestjs/platform-node";

@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(
    _request: unknown,
    response: NodeResponse,
    next: (error?: unknown) => void,
  ): void {
    response.setHeader("Cache-Control", "no-store");
    next();
  }
}
