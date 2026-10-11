/**
 * Domain mount contract: the shape every business domain contributes to the
 * app factory. It lives in its own file (not inside app.ts) because domain
 * module factories import this type — ESLint bars domains from the HTTP
 * assembly internals but not from this contract.
 */

import type { FastifyPluginAsync } from "fastify";

export interface MountedDomain {
  /** Domain name: assembly diagnostics and startup logging. */
  name: string;
  /** Route plugin: dependencies are closed over by the domain module factory. */
  plugin: FastifyPluginAsync;
}
