/**
 * Schedule domain assembly: the database and the repository over it, the
 * service and the routes. AI disabled (no configured runtime model)
 * keeps the extractor undefined: the service then answers the
 * one-sentence path with the shared unconfigured error, which chat
 * maps to its honest notice. A shared agentFactory (traced, from the
 * composition root) takes precedence over the locally built one.
 */

import type { FastifyPluginAsync } from "fastify";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import {
  createTobyAgentFactory,
  type TobyAgentFactory,
} from "../../infrastructure/model/agent.ts";
import { createScheduleDb } from "./db.ts";
import {
  createScheduleExtractor,
  type ScheduleExtractionReads,
  type ScheduleExtractor,
  type ScheduleMemoryPort,
} from "./extraction.ts";
import { resolveRange } from "./validation.ts";
import { createScheduleRepository } from "./repository.ts";
import { scheduleRoutes } from "./routes.ts";
import { createScheduleService, type ScheduleService } from "./service.ts";

export interface SchedulePluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /** Test seam: a fake extractor in place of the real AI one. */
  extractor?: ScheduleExtractor;
  /** A shared agent factory (the composition root passes a traced one). */
  agentFactory?: TobyAgentFactory;
  /**
   * The memory wiring port (docs/decisions/personal-agent-memory.md):
   * whole-book `<memory>` section plus the shared conversational memory
   * tools for the extraction agent. A wiring port, not a domain import —
   * the composition root binds the memory service to it.
   */
  memory?: ScheduleMemoryPort;
}

/** The assembled schedule domain: its mount step and its service handle. */
export interface ScheduleDomain {
  readonly plugin: FastifyPluginAsync;
  readonly service: ScheduleService;
}

/**
 * Builds the whole schedule domain and returns both its plugin and its
 * service — the composition root hands the service to the chat
 * capability; mounting still happens through the plugin so lifecycle
 * (database close) stays in one place.
 */
export function createScheduleDomain(
  options: SchedulePluginOptions,
): ScheduleDomain {
  const clock = options.clock ?? Date.now;
  const db = createScheduleDb({ config: options.config });
  const repository = createScheduleRepository({ db, clock });
  // The extraction agent's read tools answer from the repository, with
  // the same inclusive-window rule the HTTP list enforces.
  const reads: ScheduleExtractionReads = {
    listItems: () => repository.listItems(),
    listEntries: async (from, to) => {
      const range = resolveRange(from, to);
      return repository.listEntryViewsInRange(range.from, range.to);
    },
  };
  const buildExtractor = (): ScheduleExtractor | undefined => {
    const build = (factory: TobyAgentFactory): ScheduleExtractor =>
      createScheduleExtractor({
        agentFactory: factory,
        reads,
        ...(options.memory ? { memory: options.memory } : {}),
      });
    if (options.agentFactory) {
      return build(options.agentFactory);
    }
    if (options.config.ai) {
      // Standalone seam (tests): a constant resolver over the env config.
      const envAi = options.config.ai;
      return build(createTobyAgentFactory(async () => envAi, {}));
    }
    return undefined;
  };
  const extractor = options.extractor ?? buildExtractor();
  const service = createScheduleService({
    repository,
    clock,
    extractor,
  });
  const plugin: FastifyPluginAsync = async (app) => {
    await app.register(scheduleRoutes, { service });
    app.addHook("onClose", async () => {
      await db.close();
    });
  };
  return { plugin, service };
}
