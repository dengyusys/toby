/**
 * Nest application factory over the Fastify adapter: the server's
 * cross-cutting contract stays byte-identical while domains live as Nest
 * modules/controllers — the unified { error: { code, message } } envelope
 * via a global exception filter, the 404/405 discrimination and the
 * non-JSON content parser on the adapter instance, the two SPA static
 * roots, and the root session guard as a global Nest guard. Domain modules
 * arrive as imports; this file knows nothing about any specific domain.
 */

import "reflect-metadata";
import {
  Catch,
  Module,
  NotFoundException,
  type ArgumentsHost,
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  type ExceptionFilter,
  type Type,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import {
  HTTP_STATUS,
  createErrorResponse,
  type RequestGuardFn,
} from "./contract.ts";
import { sendJsonReply } from "./response.ts";
import { staticAssetsPlugin } from "./static-assets.ts";

export interface NestServerOptions {
  webRoot: string;
  mobileWebRoot: string;
  /** Domain modules to import into the runtime root module. */
  domainModules: Array<Type<unknown> | DynamicModule>;
  /** Root-level session gating; applied to every Nest-routed endpoint. */
  requestGuard?: RequestGuardFn;
  /**
   * Trust X-Forwarded-For from a fronting reverse proxy (TOBY_TRUST_PROXY),
   * so request.ip and per-IP limits see real client addresses. Off by
   * default: enable only behind a proxy you control.
   */
  trustProxy?: boolean;
  /** Runtime pino instance: access logs and request.log. Omit for silence. */
  logger?: Logger;
}

/** What callers (main, tests) need from the assembled app. */
export interface NestServer {
  /** light-my-request inject, bound to the underlying Fastify instance. */
  inject: FastifyInstance["inject"];
  listen(host: string, port: number): Promise<void>;
  close(): Promise<void>;
}

// Recognized structurally (Error + code + status) so this layer never
// imports any domain class.
type DomainHttpError = Error & { code: string; status: number };

function isDomainHttpError(error: unknown): error is DomainHttpError {
  if (!(error instanceof Error)) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return typeof code === "string" && typeof status === "number";
}

/**
 * Unified error boundary as a Nest filter. Mapping order:
 *   1. Fastify body-parse errors: oversized 413, invalid/empty JSON 400;
 *   2. Not-found: 405 when the path exists under another method, else 404;
 *   3. Domain-shaped errors (Error + code + status): their own envelope;
 *   4. Fallback: full stack stays in server logs, sanitized 500 out.
 */
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  constructor(private readonly instance: FastifyInstance) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const error = exception as Error & { code?: string };

    if (error?.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      this.replyBodyTooLarge(reply);
    } else if (
      error?.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      error?.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
    ) {
      this.replyInvalidJson(
        reply,
        error.code === "FST_ERR_CTP_EMPTY_JSON_BODY",
      );
    } else if (exception instanceof NotFoundException) {
      this.replyRouteMismatch(reply, request);
    } else if (isDomainHttpError(error)) {
      this.replyDomainError(reply, error);
    } else {
      this.replyUnexpected(reply, request, error);
    }
  }

  private replyBodyTooLarge(reply: FastifyReply): void {
    sendJsonReply(
      reply,
      HTTP_STATUS.payloadTooLarge,
      createErrorResponse(
        "PAYLOAD_TOO_LARGE",
        "request body exceeds the limit",
      ),
    );
  }

  private replyInvalidJson(reply: FastifyReply, emptyBody: boolean): void {
    sendJsonReply(
      reply,
      HTTP_STATUS.badRequest,
      createErrorResponse(
        "INVALID_JSON",
        emptyBody
          ? "request body must be a JSON object"
          : "request body is not valid JSON",
      ),
    );
  }

  // Nest's default not-found handler throws NotFoundException; a path
  // that exists under another method is a 405, everything else is the
  // 404 envelope.
  private replyRouteMismatch(
    reply: FastifyReply,
    request: FastifyRequest,
  ): void {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const mismatched = (this.instance.supportedMethods ?? []).some(
      (candidate) =>
        candidate !== request.method &&
        this.instance.hasRoute({ method: candidate, url: pathname }),
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
  }

  private replyDomainError(reply: FastifyReply, error: DomainHttpError): void {
    sendJsonReply(
      reply,
      error.status,
      createErrorResponse(error.code, error.message),
    );
  }

  // Unexpected exception: sanitized 500 out, full stack in the server log.
  private replyUnexpected(
    reply: FastifyReply,
    request: FastifyRequest,
    error: unknown,
  ): void {
    request.log?.error?.({ err: error, url: request.url }, "unexpected error");
    sendJsonReply(
      reply,
      HTTP_STATUS.internalServerError,
      createErrorResponse("INTERNAL_ERROR", "internal server error"),
    );
  }
}

/**
 * Adapts the domain-provided request guard function into a global Nest
 * guard: rejection is signalled by throwing from the guard function.
 */
export class RequestGuardAdapter implements CanActivate {
  constructor(private readonly guard: RequestGuardFn) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    await this.guard(
      http.getRequest<FastifyRequest>(),
      http.getResponse<FastifyReply>(),
    );
    return true;
  }
}

/**
 * Keeps raw Fastify errors raw: the stock adapter rewrites FastifyError
 * into HttpException, discarding the FST_ERR_* code our exception filter
 * maps onto the public INVALID_JSON / PAYLOAD_TOO_LARGE envelopes.
 */
class RawErrorFastifyAdapter extends FastifyAdapter {
  mapException(error: unknown): unknown {
    return error;
  }
}

/**
 * The runtime root module. It must be a decorated class: a plain
 * DynamicModule object scans providers but skips route registration. The
 * decorator is applied imperatively so the module list assembles at
 * runtime — the equivalent of the old mount list.
 */
function createRootModule(
  domainModules: NestServerOptions["domainModules"],
): Type<unknown> {
  class RootModule {}
  Module({ imports: domainModules })(RootModule);
  return RootModule;
}

// Fallback parser for non-JSON content types: read as string; route
// families decide their own semantics.
function readBodyAsString(
  _request: FastifyRequest,
  body: string,
  done: (error: Error | null, result?: unknown) => void,
): void {
  done(null, body);
}

export async function createNestServer(
  options: NestServerOptions,
): Promise<NestServer> {
  const adapter = new RawErrorFastifyAdapter({
    bodyLimit: 16 * 1024,
    ...(options.trustProxy ? { trustProxy: true } : {}),
    // Injected-instance and silence are mutually exclusive: quiet mode is
    // always `logger: false`, never a fake instance.
    ...(options.logger
      ? { loggerInstance: options.logger }
      : { logger: false }),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    createRootModule(options.domainModules),
    adapter,
    // Nest's own bootstrap logging off; Fastify carries the access log.
    // abortOnError off: a DI failure surfaces as a normal error instead
    // of process.abort() eating it (vitest workers died with SIGABRT).
    { logger: false, abortOnError: false },
  );
  const instance = app.getHttpAdapter().getInstance();
  app.useGlobalFilters(new EnvelopeExceptionFilter(instance));
  if (options.requestGuard) {
    app.useGlobalGuards(new RequestGuardAdapter(options.requestGuard));
  }
  app.enableShutdownHooks();

  // Echo the request id back so a log line and the response that triggered
  // it can be correlated across client and server.
  instance.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  instance.addContentTypeParser("*", { parseAs: "string" }, readBodyAsString);

  const warn = options.logger
    ? options.logger.warn.bind(options.logger)
    : () => {};
  await instance.register(staticAssetsPlugin, {
    webRoot: options.webRoot,
    mobileWebRoot: options.mobileWebRoot,
    warn,
  });

  // Controllers are wired onto the adapter during init (or listen); the
  // test path never listens, so init explicitly here.
  await app.init();

  return {
    inject: instance.inject.bind(instance),
    listen: async (host, port) => {
      await app.listen(port, host);
    },
    close: () => app.close(),
  };
}
