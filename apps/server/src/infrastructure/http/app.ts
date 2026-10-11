/**
 * Toby app factory: assembles the Fastify instance and the cross-cutting
 * boundaries (error envelope, 404/405 discrimination, static assets).
 * Business domains arrive as a mount list — this file knows nothing about
 * any specific domain.
 */

import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type { Logger } from "pino";
import type { MountedDomain } from "./domain-mount.ts";
import { HTTP_STATUS, createErrorResponse } from "./contract.ts";
import { sendJsonReply } from "./response.ts";
import { registerErrorHandler } from "./error-handler.ts";
import { staticAssetsPlugin } from "./static-assets.ts";

export interface TobyServerOptions {
  webRoot: string;
  mobileWebRoot: string;
  /** Domain mount list: each domain's module factory produces a MountedDomain. */
  domains?: readonly MountedDomain[];
  /** Runtime pino instance: enables access logs and request.log. Omit for silence (tests). */
  logger?: Logger;
}

// Method mismatch is discriminated against the router's own supported
// methods (app.supportedMethods) — no hand-maintained list to drift.

export function createServer({
  webRoot,
  mobileWebRoot,
  domains = [],
  logger,
}: TobyServerOptions): FastifyInstance {
  // Injected-instance and silence are mutually exclusive: quiet mode is
  // always `logger: false`, never a fake instance.
  const fastifyOptions: FastifyServerOptions = logger
    ? { loggerInstance: logger, bodyLimit: 16 * 1024 }
    : { logger: false, bodyLimit: 16 * 1024 };
  const app = Fastify(fastifyOptions);

  // Unified error boundary: domain errors, body-parse errors, sanitized 500.
  registerErrorHandler(app);

  // Single exit for unmatched paths and method mismatches:
  //   - path exists under another method -> 405;
  //   - everything else (including static wildcard GETs) -> 404 PAGE_NOT_FOUND.
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const mismatched = (app.supportedMethods ?? []).some(
      (candidate) =>
        candidate !== request.method &&
        app.hasRoute({ method: candidate, url: pathname }),
    );
    if (mismatched) {
      sendJsonReply(
        reply,
        HTTP_STATUS.methodNotAllowed,
        createErrorResponse("METHOD_NOT_ALLOWED", "method not allowed"),
      );
      return;
    }
    sendJsonReply(
      reply,
      HTTP_STATUS.notFound,
      createErrorResponse("PAGE_NOT_FOUND", "page not found"),
    );
  });

  // Fallback parser for non-JSON content types: read as string; route
  // families decide their own semantics.
  app.addContentTypeParser(
    "*",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  // Business assembly in one encapsulated scope: static assets plus every
  // mounted domain; the error boundary stays at root scope.
  void app.register(async (scope) => {
    const warn = logger ? logger.warn.bind(logger) : () => {};
    await scope.register(staticAssetsPlugin, { webRoot, mobileWebRoot, warn });
    for (const domain of domains) {
      await scope.register(domain.plugin);
    }
  });

  return app;
}
