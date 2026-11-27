/**
 * Auth assembly: the auth database, the service with its sweeper, and the
 * public auth routes; the session guard is handed to the composition root,
 * which installs it on every `/api` route not marked public.
 */

import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { createAuthDb } from "./db.ts";
import { createAuthRepository } from "./repository.ts";
import { createAuthService } from "./service.ts";
import { authRoutes, makeRequireSession } from "./routes.ts";

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
  const clock = options.clock ?? Date.now;
  const db = createAuthDb({ config: options.config });
  const repository = createAuthRepository({ db, clock });
  const service = createAuthService({
    config: options.config,
    clock,
    repository,
  });
  return {
    requireSession: makeRequireSession(service),
    plugin: async (app) => {
      await app.register(authRoutes, { service, config: options.config });
      service.start();
      app.addHook("onClose", async () => {
        service.stop();
        await db.close();
      });
    },
  };
}
