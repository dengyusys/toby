/**
 * The runtime-settings contract: the AI client resolves its effective
 * config per request from the settings domain (database → environment →
 * default), so a settings change lands on the very next call. A real
 * settings domain runs over sqlite in a fresh temporary directory per
 * case (its plugin is mounted on the case app, whose close releases the
 * database); the model catalog is a faux-provider collection with two
 * models, and every scripted reply echoes the id of the model that
 * served it — which is how "the next call uses the new model" is
 * proven. No real AI.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import type { Model } from "@earendil-works/pi-ai";
import { resolveConfig } from "../../../src/infrastructure/config/config.ts";
import { createSettingsDomain } from "../../../src/domains/settings/plugin.ts";
import { createTobyAgentFactory } from "../../../src/infrastructure/model/agent.ts";
import { createPiAiClient } from "../../../src/infrastructure/model/client.ts";
import { AiError } from "../../../src/infrastructure/model/errors.ts";
import { createTestApp } from "../../app-fixture.ts";
import { caughtAiError } from "../../helpers.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-runtime-settings-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-14T08:00:00.000Z");

// Two faux models: the whole point is proving WHICH one served each call.
// The module-level provider is shared across cases, so provider-call
// assertions compare against a per-case delta, never an absolute count.
const faux = fauxProvider({ models: [{ id: "faux-2" }, { id: "faux-1" }] });
const models = createModels();
models.setProvider(faux.provider);

/** Every scripted reply names the model that produced it. */
function echoModel(): void {
  faux.appendResponses([
    (_context, _options, _state, model: Model<string>) =>
      fauxAssistantMessage(`used:${model.id}`),
  ]);
}

let caseCounter = 0;
let openApp: FastifyInstance | undefined;

afterEach(async () => {
  // The plugin owns the settings database; closing the case app closes it.
  await openApp?.close();
  openApp = undefined;
});

/**
 * One fresh settings domain over its own temporary data directory, wired
 * exactly like the composition root: one models collection shared by the
 * domain and the transports, the resolver reading
 * `service.resolveRuntimeConfig()` per request.
 */
async function buildRuntime(env: Record<string, string> = {}) {
  caseCounter += 1;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`), ...env },
  });
  const settingsDomain = createSettingsDomain({
    config,
    clock: () => BASE_MS,
    createModels: () => models,
  });
  openApp = await createTestApp({
    config,
    domains: [(instance) => instance.register(settingsDomain.plugin)],
  });
  const resolveAiRuntimeConfig = async () => {
    const runtime = await settingsDomain.service.resolveRuntimeConfig();
    return runtime.model === null
      ? undefined
      : { model: runtime.model, timeoutMs: runtime.timeoutMs };
  };
  const client = createPiAiClient(resolveAiRuntimeConfig, { models });
  const agentFactory = createTobyAgentFactory(resolveAiRuntimeConfig, {
    models,
  });
  return { settings: settingsDomain.service, client, agentFactory };
}

describe("per-request runtime settings", () => {
  it("a model set only in the database serves requests with no env config", async () => {
    const { settings, client } = await buildRuntime();
    await settings.updateAiSettings({ model: "faux/faux-1" });

    expect(await settings.resolveRuntimeConfig()).toEqual({
      model: "faux/faux-1",
      timeoutMs: 30_000,
    });
    echoModel();
    expect(await client.text([{ role: "user", content: "hi" }])).toBe(
      "used:faux-1",
    );
  });

  it("a database model change lands on the very next call", async () => {
    const { settings, client } = await buildRuntime();
    await settings.updateAiSettings({ model: "faux/faux-1" });
    const callsBefore = faux.state.callCount;

    echoModel();
    echoModel();
    expect(await client.text([{ role: "user", content: "hi" }])).toBe(
      "used:faux-1",
    );

    await settings.updateAiSettings({ model: "faux/faux-2" });
    expect(await client.text([{ role: "user", content: "hi again" }])).toBe(
      "used:faux-2",
    );
    // Exactly the two calls; the second was served by the new model.
    expect(faux.state.callCount).toBe(callsBefore + 2);
  });

  it("the agent path picks up a model change between runs too", async () => {
    const { settings, agentFactory } = await buildRuntime();
    await settings.updateAiSettings({ model: "faux/faux-1" });
    const agent = agentFactory({
      preamble: "sys",
      tools: [],
      policy: { allowedKinds: ["read-only"], maxTurns: 2 },
    });

    echoModel();
    expect((await agent.run("go")).text).toBe("used:faux-1");

    await settings.updateAiSettings({ model: "faux/faux-2" });
    echoModel();
    expect((await agent.run("go")).text).toBe("used:faux-2");
  });

  it("nothing configured anywhere answers unconfigured without a provider call", async () => {
    const { settings, client } = await buildRuntime();
    expect(await settings.resolveRuntimeConfig()).toEqual({
      model: null,
      timeoutMs: 30_000,
    });
    const callsBefore = faux.state.callCount;

    echoModel();
    const error = await caughtAiError(
      client.text([{ role: "user", content: "hi" }]),
    );
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("unconfigured");
    expect(error.message).toContain("AI is not configured");
    // The unconfigured throw happens before any provider I/O.
    expect(faux.state.callCount).toBe(callsBefore);
  });

  it("clearing the database model falls back to the environment on the next call", async () => {
    const { settings, client } = await buildRuntime({
      TOBY_AI_MODEL: "faux/faux-2",
      TOBY_AI_TIMEOUT_MS: "60000",
    });
    // The database row wins over the environment; the timeout is
    // env-only — the database never configures it.
    await settings.updateAiSettings({ model: "faux/faux-1" });
    expect(await settings.resolveRuntimeConfig()).toEqual({
      model: "faux/faux-1",
      timeoutMs: 60_000,
    });
    echoModel();
    expect(await client.text([{ role: "user", content: "hi" }])).toBe(
      "used:faux-1",
    );

    await settings.updateAiSettings({ model: null });
    expect(await settings.resolveRuntimeConfig()).toEqual({
      model: "faux/faux-2",
      timeoutMs: 60_000,
    });
    echoModel();
    expect(await client.text([{ role: "user", content: "hi again" }])).toBe(
      "used:faux-2",
    );
  });
});
