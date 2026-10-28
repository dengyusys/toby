/**
 * Auth routes: login/logout/session. The token lives only in an HttpOnly cookie
 * and the server-side expiry is the source of truth. All three routes are
 * `@Public` (logout stays idempotent; the login page queries the session
 * first).
 */

import {
  Body,
  Controller,
  Cookies,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { NodeResponse } from "@nestjs/platform-node";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import { Public } from "../../infrastructure/http/public.decorator.ts";
import { TOBY_CONFIG } from "../../infrastructure/providers/shared-tokens.ts";
import { LOGIN_BODY_SCHEMA, type LoginBody } from "./dto/login.dto.ts";
import { SESSION_COOKIE } from "./cookie.ts";
import { LOGIN_SUCCESS, AuthService } from "./auth.service.ts";
import type { AuthLoginSuccess, AuthSessionInfo } from "./types.ts";

@Public()
@Controller("api/auth")
export class AuthController {
  private readonly secureCookie: boolean;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly service: AuthService,
    private readonly adapterHost: HttpAdapterHost,
    @Inject(TOBY_CONFIG) config: TobyConfig,
  ) {
    this.secureCookie = config.auth.secureCookie;
    this.sessionTtlMs = config.auth.sessionTtlMs;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: LOGIN_BODY_SCHEMA }) body: LoginBody,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<AuthLoginSuccess> {
    const grant = await this.service.login(body.password ?? "");
    this.adapterHost.httpAdapter.setCookie?.(
      response,
      SESSION_COOKIE,
      grant.token,
      {
        ...this.cookieAttributes(),
        maxAge: Math.floor(this.sessionTtlMs / 1000),
      },
    );
    return LOGIN_SUCCESS;
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Cookies(SESSION_COOKIE) token: string | undefined,
    @Res({ passthrough: true }) response: NodeResponse,
  ): Promise<{ status: "ok" }> {
    await this.service.logout(token);
    this.adapterHost.httpAdapter.clearCookie?.(
      response,
      SESSION_COOKIE,
      this.cookieAttributes(),
    );
    return { status: "ok" };
  }

  @Get("session")
  session(@Cookies(SESSION_COOKIE) token: string | undefined): AuthSessionInfo {
    return this.service.session(token);
  }

  /** Attributes shared by the set and the clearing header. */
  private cookieAttributes(): {
    path: string;
    httpOnly: boolean;
    sameSite: "strict";
    secure: boolean;
  } {
    return {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: this.secureCookie,
    };
  }
}
