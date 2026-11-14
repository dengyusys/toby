/**
 * The settings service: effective AI settings resolution (database row →
 * environment, per field), provider statuses with masked keys only, the
 * catalog passthrough, and the one transactional write behind PUT. Key
 * material never leaves this service unmasked. The request timeout is not
 * settings-configurable — it stays an ops concern (TOBY_AI_TIMEOUT_MS).
 */

import type { Clock } from "../../infrastructure/clock.ts";
import {
  DEFAULT_AI_TIMEOUT_MS,
  validateModelSpec,
} from "../../infrastructure/model/validation.ts";
import { SettingsRequestError } from "./errors.ts";
import type { SettingsRepository } from "./repository.ts";
import {
  AI_MODEL_KEY,
  type AiCatalog,
  type AiModelField,
  type AiRuntimeValues,
  type AiSettingsUpdate,
  type AiSettingsView,
  type ProviderStatus,
} from "./types.ts";

/** The environment fallback for the AI settings (what config.ai carries). */
export interface EnvAiSettings {
  readonly model?: string;
  readonly timeoutMs: number;
}

/** Anything this short is masked outright, not previewed. */
const MASKED_SHORT_KEY = "••••••";

export interface SettingsServiceDeps {
  repository: SettingsRepository;
  /**
   * Reserved: rows are stamped by the repository's own clock, and the
   * view carries no timestamps today — kept for the day a receipt does.
   */
  clock: Clock;
  /** The environment fallback; absent = no env model, default timeout. */
  envAi?: EnvAiSettings;
  /** Provider ids the catalog knows; credential writes are gated on it. */
  knownProviders: ReadonlySet<string>;
  /** Side-effect-free configured check per provider id (pi-ai checkAuth upstream). */
  authProbe: (providerId: string) => Promise<boolean>;
  /** The model catalog grouped by provider, already sorted. */
  catalogView: readonly { id: string; models: readonly string[] }[];
}

export interface SettingsService {
  /** The effective view: database row → environment, per field. */
  getAiSettings(): Promise<AiSettingsView>;
  /** Only the configured providers: a stored row, or an ambient env config. */
  getProviderStatuses(): Promise<readonly ProviderStatus[]>;
  /**
   * The values an AI request resolves to — model: database → environment;
   * timeout: environment → built-in default (ops-only) — without provider
   * statuses. The per-request resolver's cheap path: one point read, no
   * auth probes.
   */
  resolveRuntimeConfig(): Promise<AiRuntimeValues>;
  getCatalog(): AiCatalog;
  /** Validate, then land the whole change in one transactional write. */
  updateAiSettings(body: AiSettingsUpdate): Promise<AiSettingsView>;
  /** A display mask: ≤ 8 chars hide entirely, longer keep first 3 / last 4. */
  mask(key: string): string;
}

export function createSettingsService(
  deps: SettingsServiceDeps,
): SettingsService {
  const { repository, envAi, knownProviders, authProbe, catalogView } = deps;

  const mask = (key: string): string =>
    key.length <= 8 ? MASKED_SHORT_KEY : `${key.slice(0, 3)}…${key.slice(-4)}`;

  /**
   * Stored credential JSON is opaque to the domain, but the masked preview
   * needs the key field — so this parses defensively and only ever hands
   * the value to `mask`, never out.
   */
  const storedKeyOf = (credentialJson: string): string | null => {
    try {
      const parsed: unknown = JSON.parse(credentialJson);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as { type?: unknown }).type === "api_key" &&
        typeof (parsed as { key?: unknown }).key === "string"
      ) {
        return (parsed as { key: string }).key;
      }
    } catch {
      // Invalid JSON: no key to preview.
    }
    return null;
  };

  async function resolveModel(): Promise<AiModelField> {
    const stored = await repository.get(AI_MODEL_KEY);
    if (stored !== null) {
      return { value: stored, source: "db" };
    }
    if (envAi?.model) {
      return { value: envAi.model, source: "env" };
    }
    return { value: null, source: null };
  }

  async function resolveRuntimeConfig(): Promise<AiRuntimeValues> {
    // The timeout is an ops concern: environment fallback, then the
    // built-in default — never read from the settings database.
    return {
      model: (await resolveModel()).value,
      timeoutMs: envAi?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    };
  }

  async function getProviderStatuses(): Promise<readonly ProviderStatus[]> {
    const statuses = new Map<string, ProviderStatus>();
    // Stored rows win, whatever the ambient environment says.
    for (const id of await repository.listCredentialIds()) {
      const credentialJson = await repository.readCredential(id);
      const key = credentialJson === null ? null : storedKeyOf(credentialJson);
      statuses.set(id, {
        id,
        source: "stored",
        maskedKey: key === null ? null : mask(key),
      });
    }
    for (const id of knownProviders) {
      if (statuses.has(id)) {
        continue;
      }
      if (await authProbe(id)) {
        statuses.set(id, { id, source: "env", maskedKey: null });
      }
    }
    return [...statuses.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  async function getAiSettings(): Promise<AiSettingsView> {
    const [model, providers] = await Promise.all([
      resolveModel(),
      getProviderStatuses(),
    ]);
    return { model, providers };
  }

  return {
    getAiSettings,

    getProviderStatuses,

    resolveRuntimeConfig,

    getCatalog() {
      return { providers: catalogView };
    },

    async updateAiSettings(body) {
      const setSettings: { key: string; value: string }[] = [];
      const deleteSettings: string[] = [];
      const setCredentials: { providerId: string; credentialJson: string }[] =
        [];
      const deleteCredentials: string[] = [];

      if (body.model !== undefined) {
        if (body.model === null) {
          deleteSettings.push(AI_MODEL_KEY);
        } else {
          let model: string;
          try {
            model = validateModelSpec(body.model);
          } catch {
            throw new SettingsRequestError(
              "SETTINGS_INVALID_MODEL",
              'model must be a "provider/model" pair (e.g. "zai/glm-4.7")',
            );
          }
          setSettings.push({ key: AI_MODEL_KEY, value: model });
        }
      }

      for (const change of body.credentials ?? []) {
        if (!knownProviders.has(change.provider)) {
          throw new SettingsRequestError(
            "SETTINGS_UNKNOWN_PROVIDER",
            `unknown provider: ${change.provider}`,
          );
        }
        if (change.clear === true) {
          if (change.apiKey !== undefined) {
            throw new SettingsRequestError(
              "SETTINGS_INVALID_CREDENTIAL",
              "a credential entry cannot set and clear at once",
            );
          }
          deleteCredentials.push(change.provider);
        } else if (change.apiKey !== undefined) {
          if (change.apiKey.trim() === "") {
            throw new SettingsRequestError(
              "SETTINGS_INVALID_CREDENTIAL",
              "apiKey must be a non-empty string",
            );
          }
          // Stored verbatim as pi-ai's api-key credential; the adapter
          // (infrastructure/model/credential-store.ts) gives it its typing.
          setCredentials.push({
            providerId: change.provider,
            credentialJson: JSON.stringify({
              type: "api_key",
              key: change.apiKey,
            }),
          });
        } else {
          throw new SettingsRequestError(
            "SETTINGS_INVALID_CREDENTIAL",
            "a credential entry must carry apiKey or clear",
          );
        }
      }

      // One transactional write for the whole PUT.
      await repository.apply({
        setSettings,
        deleteSettings,
        setCredentials,
        deleteCredentials,
      });
      return getAiSettings();
    },

    mask,
  };
}
