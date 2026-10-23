/**
 * Auth domain Nest module: builds the service from config and returns it
 * together with the module and the root request guard — the guard is how
 * authentication, once enabled, covers every domain's endpoints while
 * exempting the login endpoint itself and the static pages carrying the
 * login UI. The session sweeper runs until the application shuts down
 * (lazy expiry already covers correctness; the sweeper only bounds memory).
 */

import { type DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { RequestGuardFn } from "../../infrastructure/http/contract.ts";
import {
  assembleAuthService,
  type AuthService,
  type AuthServiceDeps,
} from "./service.ts";
import { AuthController, readSessionCookie } from "./auth.controller.ts";
import { AUTH_COOKIE, AUTH_SERVICE } from "./tokens.ts";

const AUTH_LIFECYCLE = Symbol("AUTH_LIFECYCLE");

const SESSION_SWEEP_INTERVAL_MS = 60_000;

export interface AuthNestAssembly {
  module: DynamicModule;
  /** Root-level request guard: no-op while auth is disabled. */
  requestGuard: RequestGuardFn;
  service: AuthService;
}

export function createAuthModule(
  config: TobyConfig,
  deps: AuthServiceDeps = {},
): AuthNestAssembly {
  const service = assembleAuthService(config.auth, deps);
  const requestGuard = async (request: FastifyRequest): Promise<void> => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    service.requireSession(pathname, readSessionCookie(request));
  };
  const sweeper = setInterval(() => {
    service.sweepSessions();
  }, SESSION_SWEEP_INTERVAL_MS);
  sweeper.unref();

  class AuthDomainModule {}
  const module: DynamicModule = {
    module: AuthDomainModule,
    controllers: [AuthController],
    providers: [
      { provide: AUTH_SERVICE, useValue: service },
      {
        provide: AUTH_COOKIE,
        useValue: {
          secureCookie: config.auth.secureCookie,
          sessionTtlMs: config.auth.sessionTtlMs,
        },
      },
      {
        provide: AUTH_LIFECYCLE,
        useValue: {
          onApplicationShutdown: () => {
            clearInterval(sweeper);
          },
        },
      },
    ],
    exports: [AUTH_SERVICE],
  };

  return { module, requestGuard, service };
}
