/**
 * Mounts the two SPA builds: `apps/web/dist` at `/`, `apps/web-mobile/dist`
 * at `/m/`. No SPA fallback (both apps use hash routing). A mount only
 * happens when its build exists — a fresh clone serves no pages, and API
 * requests still answer. Files that are not there (dotfiles included) fall
 * through to the shared PAGE_NOT_FOUND body.
 */

import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { PathConfig } from "../config/config.ts";

/** The mobile SPA's mount: its single leading URL segment. */
export const MOBILE_MOUNT = "m";

export async function registerStaticAssets(
  app: FastifyInstance,
  paths: Pick<PathConfig, "webRoot" | "mobileWebRoot">,
): Promise<void> {
  // One scope for both mounts, so its error handler covers only them.
  await app.register(async (scope) => {
    // @fastify/static refuses a path whose normalized form differs (dot
    // segments, doubled slashes) with a 403; to a client that is simply a
    // path that does not exist. Everything else goes to the shared handler.
    scope.setErrorHandler((error, _request, reply) => {
      if ((error as { statusCode?: unknown }).statusCode === 403) {
        reply.callNotFound();
        return;
      }
      throw error;
    });

    if (existsSync(paths.webRoot)) {
      await scope.register(fastifyStatic, {
        root: paths.webRoot,
        dotfiles: "ignore",
        // No `reply.sendFile` decorator: nothing renders templates here.
        decorateReply: false,
      });
    }
    if (existsSync(paths.mobileWebRoot)) {
      await scope.register(fastifyStatic, {
        root: paths.mobileWebRoot,
        prefix: `/${MOBILE_MOUNT}/`,
        dotfiles: "ignore",
        decorateReply: false,
      });
      // The bare mount answers 301 to the trailing-slash form, which the
      // SPA's relative assets need.
      scope.get(`/${MOBILE_MOUNT}`, (_request, reply) => {
        reply.redirect(`/${MOBILE_MOUNT}/`, 301);
      });
    }
  });
}
