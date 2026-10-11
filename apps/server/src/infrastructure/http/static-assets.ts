/**
 * Static assets plugin: serves apps/web/dist (PC entry /) and
 * apps/web-mobile/dist (mobile entry /m/), all responses no-store.
 * A missing build root only warns and skips — a fresh clone without dist
 * still gets a working API server.
 */

import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync, FastifyReply } from "fastify";

export interface StaticAssetsOptions {
  webRoot: string;
  mobileWebRoot: string;
  /** Warn through this logger when a build root is absent. */
  warn: (message: string) => void;
}

// @fastify/static deduplicates registrations by fp name: registering twice on
// one app requires distinct names; the official types miss `name`, so the
// plugin type is narrowed here.
type StaticPlugin = FastifyPluginAsync<
  fastifyStatic.FastifyStaticOptions & { name?: string }
>;

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

export const staticAssetsPlugin: FastifyPluginAsync<
  StaticAssetsOptions
> = async (app, options) => {
  const plugin = fastifyStatic as StaticPlugin;
  if (existsSync(options.webRoot)) {
    await app.register(plugin, {
      name: "web-static",
      root: options.webRoot,
      setHeaders: noStore,
    });
  } else {
    options.warn(
      `web build root missing, skipping static serving: ${options.webRoot}`,
    );
  }
  if (existsSync(options.mobileWebRoot)) {
    await app.register(plugin, {
      name: "mobile-web-static",
      root: options.mobileWebRoot,
      prefix: "/m/",
      // sendFile is decorated by the first registration; skip the second.
      decorateReply: false,
      setHeaders: noStore,
    });
    // Prefix routes only match the trailing-slash form.
    app.get("/m", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.redirect("/m/", 301);
    });
  } else {
    options.warn(
      `mobile web build root missing, skipping static serving: ${options.mobileWebRoot}`,
    );
  }
};
