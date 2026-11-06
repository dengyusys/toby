/**
 * Auth routes: login/logout/session. The token lives only in an HttpOnly
 * cookie and the server-side expiry is the source of truth. All three
 * routes stay public (logout stays idempotent; the login page queries the
 * session first).
 */

import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from "fastify";
import { z } from "zod";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import {
  SESSION_COOKIE,
  readSessionCookie,
  readSessionCookieToken,
} from "./cookie.ts";
import { LOGIN_SUCCESS, type AuthService } from "./service.ts";

/**
 * The session guard as a route preHandler: it matches the raw cookie value
 * and defers to the service. The composition root installs it on every
 * `/api` route not marked public — static pages and the auth endpoints
 * never carry it. Async, so a rejected session is the hook's rejection,
 * answered by the error boundary.
 */
export function makeRequireSession(
  service: AuthService,
): preHandlerAsyncHookHandler {
  return async (request) => {
    service.requireSession(readSessionCookie(request.headers.cookie));
  };
}

export interface AuthRoutesOptions {
  service: AuthService;
  config: TobyConfig;
}

/**
 * POST /api/auth/login body. `password` stays optional on purpose: a body
 * without it is a wrong password (401), not a malformed request — the login
 * page may submit before anything is typed.
 */
const LOGIN_BODY_SCHEMA = z.object({ password: z.string().optional() });

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  const { service } = options;
  const secureCookie = options.config.auth.secureCookie;
  const sessionTtlMs = options.config.auth.sessionTtlMs;

  /** Attributes shared by the set and the clearing header. */
  const cookieAttributes = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: secureCookie,
  };
  /** Every auth route answers without a session. */
  const isPublic = { config: { public: true } };

  app.post("/api/auth/login", isPublic, async (request, reply) => {
    const body = parseBody(LOGIN_BODY_SCHEMA, request);
    const grant = await service.login(body.password ?? "");
    reply.setCookie(SESSION_COOKIE, grant.token, {
      ...cookieAttributes,
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return LOGIN_SUCCESS;
  });

  app.post("/api/auth/logout", isPublic, async (request, reply) => {
    await service.logout(readSessionCookieToken(request.headers.cookie));
    reply.clearCookie(SESSION_COOKIE, cookieAttributes);
    return { status: "ok" };
  });

  app.get("/api/auth/session", isPublic, (request) =>
    service.session(readSessionCookieToken(request.headers.cookie)),
  );
};
