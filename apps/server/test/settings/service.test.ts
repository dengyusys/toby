/**
 * The settings service over an in-memory fake repository: effective value
 * resolution (database → environment, per field), key masking, validation
 * rejections with zero writes, and provider statuses via a fake auth
 * probe. No AI, no real keys — fake strings only.
 */

import { describe, expect, it } from "vitest";
import { SettingsRequestError } from "../../src/domains/settings/errors.ts";
import {
  createSettingsService,
  type SettingsService,
} from "../../src/domains/settings/service.ts";
import type { SettingsChanges } from "../../src/domains/settings/repository.ts";
import type { AiCatalogProvider } from "../../src/domains/settings/types.ts";

/** In-memory SettingsRepository that records whether any write happened. */
function fakeRepository() {
  const settings = new Map<string, string>();
  const credentials = new Map<string, string>();
  let writeCount = 0;
  const repository = {
    async get(key: string) {
      return settings.get(key) ?? null;
    },
    async apply(changes: SettingsChanges) {
      writeCount += 1;
      for (const key of changes.deleteSettings ?? []) {
        settings.delete(key);
      }
      for (const { key, value } of changes.setSettings ?? []) {
        settings.set(key, value);
      }
      for (const id of changes.deleteCredentials ?? []) {
        credentials.delete(id);
      }
      for (const { providerId, credentialJson } of changes.setCredentials ??
        []) {
        credentials.set(providerId, credentialJson);
      }
    },
    async readCredential(providerId: string) {
      return credentials.get(providerId) ?? null;
    },
    async listCredentialIds() {
      return [...credentials.keys()].sort();
    },
    writes: () => writeCount,
    settings,
    credentials,
  };
  return repository;
}

type Repository = ReturnType<typeof fakeRepository>;

function buildService(options: {
  repository: Repository;
  envAi?: { model?: string; timeoutMs: number };
  knownProviders?: ReadonlySet<string>;
  authProbe?: (providerId: string) => Promise<boolean>;
  catalogView?: readonly AiCatalogProvider[];
}): SettingsService {
  return createSettingsService({
    repository: options.repository,
    clock: () => Date.parse("2026-11-14T08:00:00.000Z"),
    ...(options.envAi ? { envAi: options.envAi } : {}),
    knownProviders: options.knownProviders ?? new Set(["zai", "deepseek"]),
    authProbe: options.authProbe ?? (async () => false),
    catalogView: options.catalogView ?? [
      { id: "deepseek", models: ["deepseek-chat"] },
      { id: "zai", models: ["glm-4.7", "glm-5"] },
    ],
  });
}

async function caughtCode(promise: Promise<unknown>): Promise<string> {
  const thrown = await promise.catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(SettingsRequestError);
  return (thrown as SettingsRequestError).code;
}

describe("settings service: effective values", () => {
  it("model: null without any source, env when configured, db wins over env", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository });
    expect((await service.getAiSettings()).model).toEqual({
      value: null,
      source: null,
    });

    const withEnv = buildService({
      repository,
      envAi: { model: "zai/glm-4.7", timeoutMs: 60_000 },
    });
    expect((await withEnv.getAiSettings()).model).toEqual({
      value: "zai/glm-4.7",
      source: "env",
    });

    await repository.apply({
      setSettings: [{ key: "ai.model", value: "deepseek/deepseek-chat" }],
    });
    expect((await withEnv.getAiSettings()).model).toEqual({
      value: "deepseek/deepseek-chat",
      source: "db",
    });
  });

  it("resolveRuntimeConfig: model from db/env, timeout env-only", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository });
    // Nothing anywhere: model null, the built-in default timeout.
    expect(await service.resolveRuntimeConfig()).toEqual({
      model: null,
      timeoutMs: 30_000,
    });

    const withEnv = buildService({
      repository,
      envAi: { model: "zai/glm-4.7", timeoutMs: 60_000 },
    });
    // The environment supplies both values.
    expect(await withEnv.resolveRuntimeConfig()).toEqual({
      model: "zai/glm-4.7",
      timeoutMs: 60_000,
    });

    // A stored model row wins; the timeout stays env-only — the settings
    // database never configures it.
    await repository.apply({
      setSettings: [{ key: "ai.model", value: "deepseek/deepseek-chat" }],
    });
    expect(await withEnv.resolveRuntimeConfig()).toEqual({
      model: "deepseek/deepseek-chat",
      timeoutMs: 60_000,
    });

    // With no environment fallback at all, a db model pairs with the
    // built-in default timeout.
    expect(await service.resolveRuntimeConfig()).toEqual({
      model: "deepseek/deepseek-chat",
      timeoutMs: 30_000,
    });
  });
});

describe("settings service: masking", () => {
  const repository = fakeRepository();
  const service = buildService({ repository });

  it("short keys hide entirely; longer keys keep first 3 and last 4", () => {
    expect(service.mask("abc")).toBe("••••••");
    expect(service.mask("12345678")).toBe("••••••");
    expect(service.mask("123456789")).toBe("123…6789");
    expect(service.mask("sk-full-fake-key-9876")).toBe("sk-…9876");
  });

  it("the settings view never carries a full key", async () => {
    await repository.apply({
      setCredentials: [
        {
          providerId: "zai",
          credentialJson: JSON.stringify({
            type: "api_key",
            key: "sk-full-fake-key-9876",
          }),
        },
      ],
    });
    const view = await service.getAiSettings();
    expect(JSON.stringify(view)).not.toContain("sk-full-fake-key-9876");
    expect(view.providers).toEqual([
      { id: "zai", source: "stored", maskedKey: "sk-…9876" },
    ]);
  });
});

describe("settings service: update validation", () => {
  const envAi = { model: "zai/glm-4.7", timeoutMs: 60_000 };

  it("rejects bad model specs with SETTINGS_INVALID_MODEL and zero writes", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository, envAi });
    for (const model of [
      "glm-4.7",
      "ZAI/glm-4.7",
      "",
      "zai/has space",
      "/glm",
    ]) {
      expect(await caughtCode(service.updateAiSettings({ model }))).toBe(
        "SETTINGS_INVALID_MODEL",
      );
    }
    expect(repository.writes()).toBe(0);
  });

  it("rejects unknown providers with SETTINGS_UNKNOWN_PROVIDER", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository, envAi });
    expect(
      await caughtCode(
        service.updateAiSettings({
          credentials: [{ provider: "unknown-provider", apiKey: "fake-key" }],
        }),
      ),
    ).toBe("SETTINGS_UNKNOWN_PROVIDER");
    expect(repository.writes()).toBe(0);
  });

  it("rejects empty or actionless credential entries with SETTINGS_INVALID_CREDENTIAL", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository, envAi });
    for (const credentials of [
      [{ provider: "zai", apiKey: "   " }],
      [{ provider: "zai", apiKey: "" }],
      [{ provider: "zai" }],
      [{ provider: "zai", apiKey: "fake-key", clear: true }],
    ]) {
      expect(await caughtCode(service.updateAiSettings({ credentials }))).toBe(
        "SETTINGS_INVALID_CREDENTIAL",
      );
    }
    expect(repository.writes()).toBe(0);
  });

  it("lands a valid PUT as one write and answers the effective view", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository, envAi });
    const view = await service.updateAiSettings({
      model: "deepseek/deepseek-chat",
      credentials: [{ provider: "zai", apiKey: "sk-full-fake-key-9876" }],
    });
    expect(repository.writes()).toBe(1);
    expect(view.model).toEqual({
      value: "deepseek/deepseek-chat",
      source: "db",
    });
    expect(view.providers).toEqual([
      { id: "zai", source: "stored", maskedKey: "sk-…9876" },
    ]);
    // The full key never leaks through the view.
    expect(JSON.stringify(view)).not.toContain("sk-full-fake-key-9876");
    expect(repository.credentials.get("zai")).toBe(
      JSON.stringify({ type: "api_key", key: "sk-full-fake-key-9876" }),
    );
  });

  it("model: null clears the db row and falls back to env", async () => {
    const repository = fakeRepository();
    const service = buildService({ repository, envAi });
    await service.updateAiSettings({ model: "deepseek/deepseek-chat" });
    const cleared = await service.updateAiSettings({ model: null });
    expect(cleared.model).toEqual({ value: "zai/glm-4.7", source: "env" });
    expect(repository.settings.size).toBe(0);
  });

  it("clearing a credential removes the row; the provider falls back to env", async () => {
    const repository = fakeRepository();
    const service = buildService({
      repository,
      envAi,
      authProbe: async (id) => id === "zai",
    });
    await service.updateAiSettings({
      credentials: [{ provider: "zai", apiKey: "sk-full-fake-key-9876" }],
    });
    expect(await service.getProviderStatuses()).toEqual([
      { id: "zai", source: "stored", maskedKey: "sk-…9876" },
    ]);

    const after = await service.updateAiSettings({
      credentials: [{ provider: "zai", clear: true }],
    });
    expect(repository.credentials.size).toBe(0);
    expect(after.providers).toEqual([
      { id: "zai", source: "env", maskedKey: null },
    ]);
  });
});

describe("settings service: provider statuses", () => {
  it("stored rows win over the probe; probe-driven env entries join them", async () => {
    const repository = fakeRepository();
    repository.credentials.set(
      "deepseek",
      JSON.stringify({ type: "api_key", key: "fake-ds-key-123456789" }),
    );
    const service = buildService({
      repository,
      authProbe: async (id) => id === "zai" || id === "deepseek",
    });
    expect(await service.getProviderStatuses()).toEqual([
      { id: "deepseek", source: "stored", maskedKey: "fak…6789" },
      { id: "zai", source: "env", maskedKey: null },
    ]);
  });

  it("unconfigured providers appear nowhere; a stored row for an unknown provider still shows", async () => {
    const repository = fakeRepository();
    repository.credentials.set(
      "legacy",
      JSON.stringify({ type: "api_key", key: "short" }),
    );
    const service = buildService({
      repository,
      authProbe: async () => false,
    });
    expect(await service.getProviderStatuses()).toEqual([
      { id: "legacy", source: "stored", maskedKey: "••••••" },
    ]);
  });

  it("a stored row with unparseable JSON previews no key at all", async () => {
    const repository = fakeRepository();
    repository.credentials.set("zai", "not json at all");
    // No ambient configuration: only the stored row can appear.
    const service = buildService({ repository, authProbe: async () => false });
    expect(await service.getProviderStatuses()).toEqual([
      { id: "zai", source: "stored", maskedKey: null },
    ]);
  });
});

describe("settings service: catalog", () => {
  it("passes the injected catalog view through untouched", () => {
    const repository = fakeRepository();
    const catalogView: readonly AiCatalogProvider[] = [
      { id: "zai", models: ["glm-4.7", "glm-5"] },
    ];
    const service = buildService({ repository, catalogView });
    expect(service.getCatalog()).toEqual({ providers: catalogView });
  });
});
