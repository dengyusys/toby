/**
 * Memory domain assembly: the storage file and the repository over it,
 * the service and the routes. No background lifecycle — the file is
 * opened per operation, so there is nothing to close.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import { createMemoryFile } from "./memory-file.ts";
import { createMemoryRepository } from "./repository.ts";
import { memoryRoutes } from "./routes.ts";
import { createMemoryService } from "./service.ts";
import type { MemoryService } from "./types.ts";

export interface MemoryPluginOptions {
  config: TobyConfig;
  clock?: Clock;
}

/** The assembled memory domain: its mount step and its service handle. */
export interface MemoryDomain {
  readonly plugin: FastifyPluginAsync;
  readonly service: MemoryService;
}

/**
 * Builds the whole memory domain and returns both its plugin and its
 * service — the composition root hands the service to other lanes (chat
 * tools, prompt builders); mounting still happens through the plugin.
 */
export function createMemoryDomain(options: MemoryPluginOptions): MemoryDomain {
  const clock = options.clock ?? Date.now;
  const memoryFile = createMemoryFile({ config: options.config });
  const repository = createMemoryRepository({ memoryFile, clock });
  const service = createMemoryService({ repository, clock });
  const plugin: FastifyPluginAsync = async (app) => {
    await app.register(memoryRoutes, { service });
  };
  return { plugin, service };
}
