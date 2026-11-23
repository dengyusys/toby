/**
 * Settings assembly: one Models instance (this domain's credential store
 * attached) serves the catalog, the auth statuses and every AI request.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { TobyConfig } from "../../infrastructure/config/config.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type { SettingsCredentialStore } from "../../infrastructure/model/credential-store.ts";
import { createSettingsCredentialStore } from "../../infrastructure/model/credential-store.ts";
import { createSettingsDb } from "./db.ts";
import { createSettingsRepository } from "./repository.ts";
import { settingsRoutes } from "./routes.ts";
import { createAiTestProbe } from "../../infrastructure/model/test-probe.ts";
import { createSettingsService, type SettingsService } from "./service.ts";
import type { AiCatalogProvider, AiTestProbe } from "./types.ts";

export interface SettingsPluginOptions {
  config: TobyConfig;
  clock?: Clock;
  /**
   * Builds the pi-ai catalog the domain serves, with the domain's
   * credential store attached — the composition root passes one factory
   * so the catalog, its credentials and these statuses are the same
   * instance. Tests inject a factory over a faux-provider collection.
   */
  createModels?: (deps: { credentialStore: SettingsCredentialStore }) => Models;
  /** Test seam: a configured check in place of pi-ai's checkAuth probe. */
  authProbe?: (providerId: string) => Promise<boolean>;
  /**
   * Test seam: the probe behind POST /test, in place of the real one-off
   * completion. Defaults to the infrastructure probe built over the shared
   * Models and this domain's credential store.
   */
  testProbe?: AiTestProbe;
}

/** The assembled settings domain: mount step, service handle, catalog. */
export interface SettingsDomain {
  readonly plugin: FastifyPluginAsync;
  readonly service: SettingsService;
  /** The pi-ai catalog (credentials attached) this domain serves and the runtime shares. */
  readonly models: Models;
  /** pi-ai's CredentialStore, backed by the settings repository. */
  readonly credentialStore: SettingsCredentialStore;
}

export function createSettingsDomain(
  options: SettingsPluginOptions,
): SettingsDomain {
  const clock = options.clock ?? Date.now;
  const db = createSettingsDb({ config: options.config });
  const repository = createSettingsRepository({ db, clock });

  // Built once: the catalog factory attaches it to the one Models instance.
  const credentialStore = createSettingsCredentialStore({
    persistence: repository,
  });
  const models = options.createModels?.({ credentialStore }) ?? builtinModels();

  const catalogMap = new Map<string, Set<string>>();
  for (const model of models.getModels()) {
    const ids = catalogMap.get(model.provider) ?? new Set<string>();
    ids.add(model.id);
    catalogMap.set(model.provider, ids);
  }
  const catalogView: AiCatalogProvider[] = [...catalogMap.entries()]
    .map(([id, ids]) => ({ id, models: [...ids].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const knownProviders = new Set(catalogView.map((entry) => entry.id));

  // pi-ai's AuthCheck carries no boolean: an answer means configured,
  // undefined means not. Any probe failure counts as unconfigured.
  const authProbe =
    options.authProbe ??
    (async (providerId: string): Promise<boolean> => {
      try {
        return (await models.checkAuth(providerId)) !== undefined;
      } catch {
        return false;
      }
    });

  // The probe shares this domain's Models and credential store; a body's
  // unsaved keys live only inside the probe's overlay.
  const testProbe =
    options.testProbe ?? createAiTestProbe({ models, credentialStore });

  const service = createSettingsService({
    repository,
    clock,
    knownProviders,
    authProbe,
    catalogView,
    testProbe,
    ...(options.config.ai
      ? {
          envAi: {
            model: options.config.ai.model,
            timeoutMs: options.config.ai.timeoutMs,
          },
        }
      : {}),
  });

  const plugin: FastifyPluginAsync = async (app) => {
    await app.register(settingsRoutes, { service });
    app.addHook("onClose", async () => {
      await db.close();
    });
  };
  return { plugin, service, models, credentialStore };
}
