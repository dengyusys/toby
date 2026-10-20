/**
 * Auth domain routes: login/logout/session. The session token travels only
 * in an HttpOnly cookie — client JavaScript never reads it. Setting and
 * clearing the cookie happens here because only this layer knows the
 * deployment shape (Secure flag); the server-side expiry stays the source
 * of truth regardless of the cookie's Max-Age.
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import {
  AuthError,
  LOGIN_SUCCESS,
  SESSION_COOKIE,
  type AuthService,
} from "./service.ts";

export interface AuthRouterDeps {
  service: AuthService;
  secureCookie: boolean;
  /** Mirrored into the cookie's Max-Age, in milliseconds. */
  sessionTtlMs: number;
}

export function readSessionCookie(
  request: FastifyRequest,
  name: string = SESSION_COOKIE,
): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator).trim();
    if (key === name && separator > 0) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export const authRouter: FastifyPluginAsync<AuthRouterDeps> = async (
  app,
  options,
) => {
  const { service, secureCookie, sessionTtlMs } = options;
  const cookieFlags = `; Path=/; HttpOnly; SameSite=Strict${secureCookie ? "; Secure" : ""}`;

  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { password?: unknown };
    const password = typeof body?.password === "string" ? body.password : "";
    try {
      const grant = await service.login(password, request.ip);
      reply.header(
        "set-cookie",
        `${SESSION_COOKIE}=${grant.token}; Max-Age=${Math.floor(sessionTtlMs / 1000)}${cookieFlags}`,
      );
      sendJsonReply(reply, HTTP_STATUS.ok, LOGIN_SUCCESS);
    } catch (error) {
      if (error instanceof AuthError && error.retryAfterSeconds) {
        reply.header("Retry-After", String(error.retryAfterSeconds));
      }
      throw error;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await service.logout(readSessionCookie(request));
    reply.header("set-cookie", `${SESSION_COOKIE}=; Max-Age=0${cookieFlags}`);
    sendJsonReply(reply, HTTP_STATUS.ok, { status: "ok" });
  });

  app.get("/api/auth/session", async (request, reply) => {
    sendJsonReply(
      reply,
      HTTP_STATUS.ok,
      service.session(readSessionCookie(request)),
    );
  });
};
