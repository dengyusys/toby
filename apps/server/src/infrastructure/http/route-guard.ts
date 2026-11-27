/**
 * The default-secure auth guard. Once installed, every `/api` route
 * registered afterwards runs the guard as its first preHandler unless it
 * opts out with `config: { public: true }` — a new route is protected by
 * default, and every exemption is visible at the route itself. A route may
 * tighten instead of exempt: `sessionOnly` keeps it to the browser session.
 * Static pages never carry the guard: the SPAs, login page included, must
 * load without a session.
 */

import type { onRouteHookHandler, preHandlerAsyncHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Exempts an `/api` route from the auth guard. */
    public?: boolean;
    /**
     * Keeps an `/api` route to the browser session: an access token answers
     * 403.
     */
    sessionOnly?: boolean;
  }
}

export function guardApiRoutes(
  guard: preHandlerAsyncHookHandler,
): onRouteHookHandler {
  return (route) => {
    if (!route.url.startsWith("/api/") || route.config?.public === true) {
      return;
    }
    const existing =
      route.preHandler === undefined ? [] : [route.preHandler].flat();
    // Idempotent: a route seen twice (e.g. a HEAD twin copied from its GET)
    // keeps a single guard.
    if (existing.includes(guard)) {
      return;
    }
    route.preHandler = [guard, ...existing];
  };
}
