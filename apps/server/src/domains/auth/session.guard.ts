/**
 * The global session guard. Whether a route is exempt is declared by the
 * route itself (@Public() on a controller class or handler) and read via
 * Reflector — the decision happens after route matching and never parses
 * the request URL, so percent-encoded paths cannot dodge the check (the
 * old prefix-matching guard could). Everything else requires a valid
 * session once authentication is enabled; a no-op guard while disabled.
 */

import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "../../infrastructure/http/public.decorator.ts";
import { readSessionCookie } from "./cookie.ts";
import { AuthService } from "./service.ts";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.auth.requireSession(readSessionCookie(request));
    return true;
  }
}
