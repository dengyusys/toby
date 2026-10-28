/**
 * Mounts the two SPA builds: `apps/web/dist` at `/`, `apps/web-mobile/dist` at
 * `/m/`. No SPA fallback (both apps use hash routing) and no
 * `@nestjs/serve-static`, which always registers a render route.
 */

import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { NodeAdapter } from "@nestjs/platform-node";
import { existsSync } from "node:fs";
import type { TobyConfig } from "../config/config.ts";
import { TOBY_CONFIG } from "../providers/shared-tokens.ts";

@Injectable()
export class StaticAssetsProvider implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(TOBY_CONFIG) private readonly config: TobyConfig,
  ) {}

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter as NodeAdapter;
    const { webRoot, mobileWebRoot } = this.config.paths;
    if (existsSync(webRoot)) {
      adapter.useStaticAssets(webRoot);
    }
    if (existsSync(mobileWebRoot)) {
      // The bare mount answers 301 to the trailing-slash form, which the SPA's
      // relative assets need.
      adapter.useStaticAssets(mobileWebRoot, { prefix: "/m" });
    }
  }
}
