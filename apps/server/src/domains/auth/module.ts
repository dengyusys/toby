/**
 * Auth domain self-assembly. Returns the mounted routes plus the
 * requestGuard the app factory installs as a root preHandler — that is how
 * authentication, once enabled, covers every domain's endpoints while
 * exempting the login endpoint itself and the static pages carrying the
 * login UI.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { MountedDomain } from "../../infrastructure/http/domain-mount.ts";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { authRouter, readSessionCookie } from "./router.ts";
import {
  assembleAuthService,
  SESSION_COOKIE,
  type AuthService,
  type AuthServiceDeps,
} from "./service.ts";

export interface AuthAssembly {
  mounted: MountedDomain;
  /** Root-level preHandler: no-op while auth is disabled. */
  requestGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  service: AuthService;
}

export async function assembleAuth(
  config: TobyConfig,
  deps: AuthServiceDeps = {},
): Promise<AuthAssembly> {
  const service = assembleAuthService(config.auth, deps);
  const requestGuard = async (request: FastifyRequest): Promise<void> => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    service.requireSession(
      pathname,
      readSessionCookie(request, SESSION_COOKIE),
    );
  };
  return {
    service,
    requestGuard,
    mounted: {
      name: "auth",
      plugin: async (app) => {
        await app.register(authRouter, {
          service,
          secureCookie: config.auth.secureCookie,
          sessionTtlMs: config.auth.sessionTtlMs,
        });
      },
    },
  };
}
