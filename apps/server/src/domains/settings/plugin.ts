/**
 * Settings domain assembly: the database and the repository over it, the
 * credential-store adapter over the repository, and the service and the
 * routes. The catalog comes from the injected `createModels` factory (the
 * composition root attaches this domain's credential store to it), so one
 * Models instance serves the catalog, the auth statuses and every AI
 * request; tests inject a factory over a faux-provider collection.
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
import { createSettingsService, type SettingsService } from "./service.ts";
import type { AiCatalogProvider } from "./types.ts";

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

  // The credential store comes first: the catalog factory attaches it, so
  // the one Models instance serves this domain's catalog and statuses AND
  // carries the stored credentials into every request.
  const credentialStore = createSettingsCredentialStore({
    persistence: repository,
  });
  const models = options.createModels?.({ credentialStore }) ?? builtinModels();

  // Catalog view + known providers, derived once from the chat models:
  // provider ids deduped, model ids grouped per provider, all sorted.
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

  const service = createSettingsService({
    repository,
    clock,
    knownProviders,
    authProbe,
    catalogView,
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
