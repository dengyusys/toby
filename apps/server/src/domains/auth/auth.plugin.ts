/**
 * Auth domain assembly: the service (with its session sweeper) and the
 * public auth routes. The plugin factory also hands the session guard to
 * the composition root, which installs it on every `/api` route not marked
 * public — cross-domain wiring never happens inside a domain.
 */

import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { createAuthService } from "./auth.service.ts";
import { authRoutes, makeRequireSession } from "./auth.routes.ts";

export interface AuthPluginOptions {
  config: TobyConfig;
  clock?: Clock;
}

export interface AuthDomain {
  /** The mountable plugin. */
  plugin: FastifyPluginAsync;
  /** The session check the composition root installs on guarded routes. */
  requireSession: preHandlerAsyncHookHandler;
}

export function authPlugin(options: AuthPluginOptions): AuthDomain {
  const service = createAuthService({
    config: options.config,
    clock: options.clock ?? Date.now,
  });
  return {
    requireSession: makeRequireSession(service),
    plugin: async (app) => {
      await app.register(authRoutes, { service, config: options.config });
      service.start();
      app.addHook("onClose", () => service.stop());
    },
  };
}
