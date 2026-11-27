/**
 * Auth routes: register/login/logout/session, the password change, and
 * access token management. The session token lives only in an HttpOnly
 * cookie and the server-side expiry is the source of truth. The session
 * routes stay public (logout stays idempotent; the login page queries the
 * session first) — registration is public by necessity and guards itself:
 * once, inside the startup window. The password change and token management
 * are session-only: an access token never manages the owner's credentials.
 */

import type {
  FastifyPluginAsync,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from "fastify";
import { z } from "zod";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { parseBody } from "../../infrastructure/http/body-schema.ts";
import { DomainHttpError } from "../../infrastructure/http/http-error.ts";
import { checkAccess, isAllowedTokenScopes, type Scope } from "./access.ts";
import {
  SESSION_COOKIE,
  readSessionCookie,
  readSessionCookieToken,
} from "./cookie.ts";
import { AuthError } from "./errors.ts";
import { LOGIN_SUCCESS, type AuthService } from "./service.ts";
import type { AccessTokenRecord } from "./types.ts";

/**
 * The auth guard as a route preHandler. The composition root installs it on
 * every `/api` route not marked public — static pages and the public auth
 * endpoints never carry it. It resolves who is calling (the owner's session
 * cookie, or an access token in the Authorization header) and then checks
 * the route's own rule: session-only, and the scope the method needs. Async,
 * so a refused caller is the hook's rejection, answered by the error boundary.
 */
export function makeAuthGuard(
  service: AuthService,
): preHandlerAsyncHookHandler {
  return async (request) => {
    const principal = await service.authenticate({
      authorization: request.headers.authorization,
      cookie: readSessionCookie(request.headers.cookie),
    });
    const denial = checkAccess(
      principal,
      request.routeOptions.config,
      request.method,
    );
    if (denial === "session-required") {
      throw new AuthError(
        "SESSION_REQUIRED",
        403,
        "this route accepts a browser session only",
      );
    }
    if (denial === "insufficient-scope") {
      throw new AuthError(
        "INSUFFICIENT_SCOPE",
        403,
        "this route needs a write token",
      );
    }
  };
}

export interface AuthRoutesOptions {
  service: AuthService;
  config: TobyConfig;
  clock: Clock;
}

/** Path parameters of the token routes. */
interface IdParams {
  Params: { id: string };
}

/**
 * POST /api/auth/login body. `password` stays optional on purpose: a body
 * without it is a wrong password (401), not a malformed request — the login
 * page may submit before anything is typed.
 */
const LOGIN_BODY_SCHEMA = z.object({ password: z.string().optional() });

/**
 * POST /api/auth/register body. Unknown fields are rejected: this body sets
 * the credential everything else hangs on. The password is any non-empty
 * string — an empty one would be no password at all, and its length is the
 * owner's call.
 */
const REGISTER_BODY_SCHEMA = z
  .object({
    password: z.string().min(1),
  })
  .strict();

/**
 * PUT /api/auth/password body. The new password must be non-empty, for the
 * same reason as at registration, and differ from the current one: a
 * "change" that keeps the password would only log everyone out.
 */
const CHANGE_PASSWORD_BODY_SCHEMA = z
  .object({
    current_password: z.string(),
    new_password: z.string().min(1),
  })
  .strict()
  .refine(
    ({ current_password, new_password }) => current_password !== new_password,
    {
      path: ["new_password"],
      message: "must differ from current_password",
    },
  );

/**
 * POST /api/auth/tokens body. `scopes` is a list so finer scopes can join
 * later; today it must hold exactly one of the two tiers.
 */
const CREATE_TOKEN_BODY_SCHEMA = z
  .object({
    name: z.string().trim().min(1).max(64),
    scopes: z
      .array(z.string())
      .refine(isAllowedTokenScopes, 'must be ["read"] or ["write"]'),
    expires_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

/** A token on the wire: everything about it but the secret, in snake_case. */
function toTokenView(record: AccessTokenRecord) {
  return {
    id: record.id,
    name: record.name,
    scopes: [...record.scopes],
    last_four: record.lastFour,
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt,
    expires_at: record.expiresAt,
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  const { service, clock } = options;
  const secureCookie = options.config.auth.secureCookie;
  const sessionTtlMs = options.config.auth.sessionTtlMs;

  /** Attributes shared by the set and the clearing header. */
  const cookieAttributes = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: secureCookie,
  };
  /** The session routes answer without a session. */
  const isPublic = { config: { public: true } };
  /** Managing credentials is the owner's own, logged-in, business. */
  const sessionOnly = { config: { sessionOnly: true } };

  /** Login and registration start the session the same way. */
  function startSession(reply: FastifyReply, grant: { token: string }) {
    reply.setCookie(SESSION_COOKIE, grant.token, {
      ...cookieAttributes,
      maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return LOGIN_SUCCESS;
  }

  app.post("/api/auth/register", isPublic, async (request, reply) => {
    const body = parseBody(REGISTER_BODY_SCHEMA, request);
    return startSession(reply, await service.register(body.password));
  });

  app.post("/api/auth/login", isPublic, async (request, reply) => {
    const body = parseBody(LOGIN_BODY_SCHEMA, request);
    return startSession(reply, await service.login(body.password ?? ""));
  });

  app.put("/api/auth/password", sessionOnly, async (request, reply) => {
    const body = parseBody(CHANGE_PASSWORD_BODY_SCHEMA, request);
    await service.changePassword(body.current_password, body.new_password);
    // Every session is gone, the caller's included.
    reply.clearCookie(SESSION_COOKIE, cookieAttributes);
    return { status: "ok" };
  });

  app.post("/api/auth/logout", isPublic, async (request, reply) => {
    await service.logout(readSessionCookieToken(request.headers.cookie));
    reply.clearCookie(SESSION_COOKIE, cookieAttributes);
    return { status: "ok" };
  });

  app.get("/api/auth/session", isPublic, (request) =>
    service.session(readSessionCookieToken(request.headers.cookie)),
  );

  app.get("/api/auth/tokens", sessionOnly, async () => ({
    tokens: (await service.listTokens()).map(toTokenView),
  }));

  app.post("/api/auth/tokens", sessionOnly, async (request) => {
    const body = parseBody(CREATE_TOKEN_BODY_SCHEMA, request);
    if (
      body.expires_at !== undefined &&
      Date.parse(body.expires_at) <= clock()
    ) {
      throw new DomainHttpError(
        400,
        "BAD_REQUEST",
        "expires_at: must be in the future",
      );
    }
    const { record, secret } = await service.createToken({
      name: body.name,
      // The schema has already narrowed this to exactly one tier.
      scopes: body.scopes as [Scope],
      expiresAt:
        body.expires_at === undefined
          ? null
          : new Date(body.expires_at).toISOString(),
    });
    // The one and only time the secret exists outside this request.
    return { token: toTokenView(record), secret };
  });

  app.delete<IdParams>("/api/auth/tokens/:id", sessionOnly, async (request) => {
    const record = await service.revokeToken(request.params.id);
    return { id: record.id, action: "revoked", revoked_at: record.revokedAt };
  });
};
