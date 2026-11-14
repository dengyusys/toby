/**
 * The AI test probe against scripted faux providers and a purpose-built
 * env-key provider (its declared key variable nobody will ever set, so
 * unconfigured-ness is deterministic without touching the host env).
 * Pins the stage classification (ok / invalid-model / auth / timeout /
 * request-failed), the reply trim, and the in-memory credential overlay:
 * an unsaved apiKey reaches auth resolution, clear skips the stored row,
 * and nothing ever persists. Automated tests never touch a real model.
 */

import { describe, expect, it } from "vitest";
import {
  createModels,
  createProvider,
  envApiKeyAuth,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createSettingsCredentialStore,
  type CredentialPersistence,
} from "../../../src/infrastructure/model/credential-store.ts";
import { createAiTestProbe } from "../../../src/infrastructure/model/test-probe.ts";

const TIMEOUT_MS = 5_000;

/** In-memory persistence shaped like the settings repository's slice. */
function fakePersistence() {
  const rows = new Map<string, string>();
  let writes = 0;
  const persistence: CredentialPersistence = {
    async readCredential(providerId) {
      return rows.get(providerId) ?? null;
    },
    async listCredentialIds() {
      return [...rows.keys()].sort();
    },
    async apply(changes) {
      writes += 1;
      for (const id of changes.deleteCredentials ?? []) {
        rows.delete(id);
      }
      for (const { providerId, credentialJson } of changes.setCredentials ??
        []) {
        rows.set(providerId, credentialJson);
      }
    },
  };
  return { rows, writes: () => writes, persistence };
}

/**
 * A provider whose auth resolves only from an env variable that is never
 * set (or a stored credential row): exercises pi-ai's genuine env-key
 * auth resolution without depending on the host environment.
 */
function envKeyProviderModels() {
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "test-envkey",
      name: "Test EnvKey",
      baseUrl: "http://127.0.0.1:9",
      auth: {
        apiKey: envApiKeyAuth("Test API key", ["TOBY_TEST_MISSING_API_KEY"]),
      },
      models: [
        {
          id: "test-model",
          name: "Test Model",
          api: "openai-completions",
          provider: "test-envkey",
          baseUrl: "http://127.0.0.1:9",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: {},
          contextWindow: 8192,
          maxTokens: 1024,
          type: "chat",
        },
      ],
      api: openAICompletionsApi(),
    }),
  );
  return models;
}

function buildProbe(models = createModels(), persistence = fakePersistence()) {
  return {
    persistence,
    probe: createAiTestProbe({
      models,
      credentialStore: createSettingsCredentialStore({
        persistence: persistence.persistence,
      }),
    }),
  };
}

describe("createAiTestProbe", () => {
  it("answers ok with the model echo, latency, and a trimmed ≤120-char reply", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.appendResponses([fauxAssistantMessage(`  ${"x".repeat(300)}  `)]);
    const { probe } = buildProbe(models);
    const outcome = await probe.probe({
      model: "faux/faux-1",
      timeoutMs: TIMEOUT_MS,
      credentials: [],
    });
    expect(outcome.stage).toBe("ok");
    expect(outcome.model).toBe("faux/faux-1");
    expect(outcome.reply).toBe("x".repeat(120));
    expect(outcome.message).toBeNull();
    expect(typeof outcome.latencyMs).toBe("number");
  });

  it("answers a catalog miss as invalid-model before any network work", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const { probe } = buildProbe(models);
    const outcome = await probe.probe({
      model: "faux/missing",
      timeoutMs: TIMEOUT_MS,
      credentials: [],
    });
    expect(outcome.stage).toBe("invalid-model");
    expect(outcome.model).toBe("faux/missing");
    expect(outcome.latencyMs).toBeNull();
    expect(outcome.message).toContain("not a known provider/model pair");
    expect(faux.state.callCount).toBe(0);
  });

  it("an error stop reason with resolvable auth lands as request-failed", async () => {
    // A stored credential row makes the env-key provider "configured",
    // so the same dead-server error classifies as a provider failure.
    const models = envKeyProviderModels();
    const { probe, persistence } = buildProbe(models);
    persistence.rows.set(
      "test-envkey",
      JSON.stringify({ type: "api_key", key: "fake-stored-key" }),
    );
    const outcome = await probe.probe({
      model: "test-envkey/test-model",
      timeoutMs: TIMEOUT_MS,
      credentials: [],
    });
    expect(outcome.stage).toBe("request-failed");
    expect(outcome.reply).toBeNull();
    expect(outcome.message).toBeTruthy();
    expect(outcome.latencyMs).not.toBeNull();
  });

  it("an error on an unconfigured provider lands as auth", async () => {
    const models = envKeyProviderModels();
    const { probe } = buildProbe(models);
    const outcome = await probe.probe({
      model: "test-envkey/test-model",
      timeoutMs: TIMEOUT_MS,
      credentials: [],
    });
    expect(outcome.stage).toBe("auth");
    expect(outcome.message).toContain("test-envkey");
  });

  it("an unsaved apiKey reaches the probe: the overlay flips auth to request-failed", async () => {
    // Same provider, same dead server — only the in-memory key differs,
    // so the classification flip proves the body's key entered auth
    // resolution without ever being stored.
    const models = envKeyProviderModels();
    const { probe, persistence } = buildProbe(models);
    const outcome = await probe.probe({
      model: "test-envkey/test-model",
      timeoutMs: TIMEOUT_MS,
      credentials: [
        { provider: "test-envkey", apiKey: "fake-unsaved-key-123456789" },
      ],
    });
    expect(outcome.stage).toBe("request-failed");
    expect(persistence.writes()).toBe(0);
    expect(persistence.rows.size).toBe(0);
  });

  it("clear skips the stored row: the (empty here) environment decides", async () => {
    const models = envKeyProviderModels();
    const { probe, persistence } = buildProbe(models);
    persistence.rows.set(
      "test-envkey",
      JSON.stringify({ type: "api_key", key: "fake-stored-key" }),
    );
    const outcome = await probe.probe({
      model: "test-envkey/test-model",
      timeoutMs: TIMEOUT_MS,
      credentials: [{ provider: "test-envkey", clear: true }],
    });
    // Without the stored row and with no env var, the provider is
    // unconfigured: auth — exactly the no-row case.
    expect(outcome.stage).toBe("auth");
    // The stored row itself was never touched.
    expect(persistence.rows.get("test-envkey")).toBe(
      JSON.stringify({ type: "api_key", key: "fake-stored-key" }),
    );
    expect(persistence.writes()).toBe(0);
  });

  it("an aborted probe lands as timeout", async () => {
    const faux = fauxProvider({
      models: [{ id: "faux-1" }],
      tokensPerSecond: 100,
    });
    const models = createModels();
    models.setProvider(faux.provider);
    const { probe } = buildProbe(models);
    // Long text at ~10 ms per chunk cannot finish inside 50 ms.
    faux.appendResponses([fauxAssistantMessage("word ".repeat(200))]);
    const outcome = await probe.probe({
      model: "faux/faux-1",
      timeoutMs: 50,
      credentials: [],
    });
    expect(outcome.stage).toBe("timeout");
    expect(outcome.reply).toBeNull();
    expect(outcome.message).toContain("timed out");
  });

  it("a probe never writes: the underlying persistence stays untouched", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-1" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const { probe, persistence } = buildProbe(models);
    persistence.rows.set(
      "test-envkey",
      JSON.stringify({ type: "api_key", key: "fake-stored-key" }),
    );
    faux.appendResponses([fauxAssistantMessage("OK")]);
    await probe.probe({
      model: "faux/faux-1",
      timeoutMs: TIMEOUT_MS,
      credentials: [{ provider: "faux", apiKey: "fake-unsaved-key" }],
    });
    expect(persistence.writes()).toBe(0);
    expect(persistence.rows.size).toBe(1);
  });
});
