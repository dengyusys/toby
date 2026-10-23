/**
 * Auth domain routes as a Nest controller: login/logout/session. The
 * session token travels only in an HttpOnly cookie — client JavaScript
 * never reads it. Setting and clearing the cookie happens here because
 * only this layer knows the deployment shape (Secure flag); the
 * server-side expiry stays the source of truth regardless of the cookie's
 * Max-Age.
 */

import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import {
  AuthError,
  LOGIN_SUCCESS,
  SESSION_COOKIE,
  type AuthService,
} from "./service.ts";
import { AUTH_COOKIE, AUTH_SERVICE } from "./tokens.ts";

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

@Controller("api/auth")
export class AuthController {
  // Property injection (see system.controller.ts for the rationale).
  @Inject(AUTH_SERVICE)
  private readonly service!: AuthService;
  @Inject(AUTH_COOKIE)
  private readonly cookie!: { secureCookie: boolean; sessionTtlMs: number };

  private cookieFlags(): string {
    return `; Path=/; HttpOnly; SameSite=Strict${this.cookie.secureCookie ? "; Secure" : ""}`;
  }

  @Post("login")
  async login(
    @Body() body: { password?: unknown },
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const password = typeof body?.password === "string" ? body.password : "";
    try {
      const grant = await this.service.login(password, request.ip);
      reply.header(
        "set-cookie",
        `${SESSION_COOKIE}=${grant.token}; Max-Age=${Math.floor(this.cookie.sessionTtlMs / 1000)}${this.cookieFlags()}`,
      );
      sendJsonReply(reply, HTTP_STATUS.ok, LOGIN_SUCCESS);
    } catch (error) {
      if (error instanceof AuthError && error.retryAfterSeconds) {
        reply.header("Retry-After", String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Post("logout")
  async logout(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.service.logout(readSessionCookie(request));
    reply.header(
      "set-cookie",
      `${SESSION_COOKIE}=; Max-Age=0${this.cookieFlags()}`,
    );
    sendJsonReply(reply, HTTP_STATUS.ok, { status: "ok" });
  }

  @Get("session")
  session(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    sendJsonReply(
      reply,
      HTTP_STATUS.ok,
      this.service.session(readSessionCookie(request)),
    );
  }
}
