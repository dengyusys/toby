/**
 * System domain routes: the walking skeleton of the server. Health is the
 * liveness probe (Docker healthcheck hits it); info exposes build and
 * runtime identity.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { HTTP_STATUS } from "../../infrastructure/http/contract.ts";
import { sendJsonReply } from "../../infrastructure/http/response.ts";
import { findPackageJsonPath } from "../../utils/paths/index.ts";
import type { SystemHealth, SystemInfo } from "./types.ts";

// The server package.json sits above this domain; findUp locates it without
// hand-counted "../" hops.
const packageJsonPath = findPackageJsonPath(
  path.dirname(fileURLToPath(import.meta.url)),
);

function readServerVersion(): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

export interface SystemRouterDeps {
  startedAt: Date;
}

export const systemRouter: FastifyPluginAsync<SystemRouterDeps> = async (
  app,
  options,
) => {
  const version = readServerVersion();

  app.get("/api/system/health", async (_request, reply) => {
    const body: SystemHealth = { status: "ok" };
    sendJsonReply(reply, HTTP_STATUS.ok, body);
  });

  app.get("/api/system/info", async (_request, reply) => {
    const body: SystemInfo = {
      name: "toby",
      version,
      node: process.versions.node,
      started_at: options.startedAt.toISOString(),
      uptime_seconds: Math.floor(
        (Date.now() - options.startedAt.getTime()) / 1000,
      ),
    };
    sendJsonReply(reply, HTTP_STATUS.ok, body);
  });
};
