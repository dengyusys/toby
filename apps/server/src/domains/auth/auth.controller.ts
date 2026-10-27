/**
 * Auth domain routes as a Nest controller: login/logout/session. The
 * session token travels only in an HttpOnly cookie — client JavaScript
 * never reads it. Setting and clearing the cookie happens here because
 * only this layer knows the deployment shape (Secure flag); the
 * server-side expiry stays the source of truth regardless of the cookie's
 * Max-Age. All three routes are @Public: logout must stay idempotent for
 * an unknown session and the login page needs the session query before
 * any cookie exists.
 */

import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { Public } from "../../infrastructure/http/public.decorator.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import { TOBY_CONFIG } from "../../infrastructure/providers/shared-tokens.ts";
import { readSessionCookie, SESSION_COOKIE } from "./cookie.ts";
import { AuthError } from "./errors.ts";
import { LOGIN_SUCCESS, AuthService } from "./service.ts";

@Public()
@Controller("api/auth")
export class AuthController {
  private readonly secureCookie: boolean;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly service: AuthService,
    @Inject(TOBY_CONFIG) config: TobyConfig,
  ) {
    this.secureCookie = config.auth.secureCookie;
    this.sessionTtlMs = config.auth.sessionTtlMs;
  }

  private cookieFlags(): string {
    return `; Path=/; HttpOnly; SameSite=Strict${this.secureCookie ? "; Secure" : ""}`;
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
        `${SESSION_COOKIE}=${grant.token}; Max-Age=${Math.floor(this.sessionTtlMs / 1000)}${this.cookieFlags()}`,
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
