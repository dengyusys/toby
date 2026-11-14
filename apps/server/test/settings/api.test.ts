/**
 * Settings domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real sqlite in a fresh temporary directory per
 * case, injected clock, a faux pi-ai catalog). Pins the public shapes: the
 * effective AI view, the one transactional PUT with its per-code 400s, the
 * catalog, the POST /test probe over a fake probe seam — plus the one rule
 * that outranks everything: no response ever carries a full key.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createSettingsDomain } from "../../src/domains/settings/plugin.ts";
import type {
  AiTestProbe,
  AiTestProbeOutcome,
} from "../../src/domains/settings/types.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-settings-api-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-14T08:00:00.000Z");
const FULL_KEY = "sk-fake-full-key-9876";

// A controlled catalog: one faux provider with two chat models, so the
// catalog assertions stay deterministic across pi-ai upgrades.
const faux = fauxProvider({ models: [{ id: "faux-2" }, { id: "faux-1" }] });
const models = createModels();
models.setProvider(faux.provider);

/** A recording probe fake: records every call, answers a fixed outcome. */
function fakeProbe(outcome?: AiTestProbeOutcome) {
  const calls: Parameters<AiTestProbe["probe"]>[0][] = [];
  const probe: AiTestProbe = {
    async probe(input) {
      calls.push({
        model: input.model,
        timeoutMs: input.timeoutMs,
        credentials: input.credentials.map((change) => ({ ...change })),
      });
      return (
        outcome ?? {
          stage: "ok",
          model: input.model,
          latencyMs: 12,
          reply: "OK",
          message: null,
        }
      );
    },
  };
  return { probe, calls };
}

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;

async function buildApp(
  options: {
    authProbe?: (providerId: string) => Promise<boolean>;
    testProbe?: AiTestProbe;
    env?: Record<string, string>;
  } = {},
): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: {
      TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`),
      ...options.env,
    },
  });
  app = await createTestApp({
    config,
    domains: [
      (instance) =>
        instance.register(
          createSettingsDomain({
            config,
            clock: () => nowMs,
            createModels: () => models,
            authProbe: options.authProbe ?? (async () => false),
            ...(options.testProbe ? { testProbe: options.testProbe } : {}),
          }).plugin,
        ),
    ],
  });
}

beforeEach(async () => {
  await buildApp();
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "PUT" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

describe("settings api: effective view", () => {
  it("answers defaults with no sources configured", async () => {
    const response = await inject("GET", "/api/settings/ai");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      model: { value: null, source: null },
      providers: [],
    });
  });

  it("a PUT lands and the GET view follows; no response ever carries the full key", async () => {
    const put = await inject("PUT", "/api/settings/ai", {
      model: "faux/faux-1",
      credentials: [{ provider: "faux", apiKey: FULL_KEY }],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      model: { value: "faux/faux-1", source: "db" },
      providers: [{ id: "faux", source: "stored", maskedKey: "sk-…9876" }],
    });
    expect(put.body).not.toContain(FULL_KEY);

    const get = await inject("GET", "/api/settings/ai");
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(put.json());
    expect(get.body).not.toContain(FULL_KEY);
  });

  it("a stored credential outranks an ambient env configuration", async () => {
    await buildApp({ authProbe: async (id) => id === "faux" });
    const stored = await inject("PUT", "/api/settings/ai", {
      credentials: [{ provider: "faux", apiKey: FULL_KEY }],
    });
    expect(stored.json().providers).toEqual([
      { id: "faux", source: "stored", maskedKey: "sk-…9876" },
    ]);

    // Clearing the row falls back to the environment.
    const cleared = await inject("PUT", "/api/settings/ai", {
      credentials: [{ provider: "faux", clear: true }],
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().providers).toEqual([
      { id: "faux", source: "env", maskedKey: null },
    ]);
    expect(cleared.body).not.toContain(FULL_KEY);
  });
});

describe("settings api: PUT validation", () => {
  it("each semantic failure answers its own 400 code with zero writes", async () => {
    for (const [body, code] of [
      [{ model: "nope" }, "SETTINGS_INVALID_MODEL"],
      [{ model: "FAUX/faux-1" }, "SETTINGS_INVALID_MODEL"],
      [
        { credentials: [{ provider: "unknown", apiKey: FULL_KEY }] },
        "SETTINGS_UNKNOWN_PROVIDER",
      ],
      [
        { credentials: [{ provider: "faux", apiKey: "" }] },
        "SETTINGS_INVALID_CREDENTIAL",
      ],
      [
        { credentials: [{ provider: "faux", apiKey: "  " }] },
        "SETTINGS_INVALID_CREDENTIAL",
      ],
      [
        { credentials: [{ provider: "faux", apiKey: FULL_KEY, clear: true }] },
        "SETTINGS_INVALID_CREDENTIAL",
      ],
      [{ credentials: [{ provider: "faux" }] }, "SETTINGS_INVALID_CREDENTIAL"],
    ] as [Record<string, unknown>, string][]) {
      const response = await inject("PUT", "/api/settings/ai", body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().errorCode, JSON.stringify(body)).toBe(code);
    }
    // Nothing landed anywhere.
    const get = await inject("GET", "/api/settings/ai");
    expect(get.json()).toEqual({
      model: { value: null, source: null },
      providers: [],
    });
  });

  it("an unknown field is SETTINGS_BODY_INVALID, not a framework code", async () => {
    const response = await inject("PUT", "/api/settings/ai", {
      model: "faux/faux-1",
      extra: 1,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("SETTINGS_BODY_INVALID");
  });

  it("timeoutMs in the PUT body is an unknown field: SETTINGS_BODY_INVALID", async () => {
    // The request timeout left the settings surface (an ops concern via
    // TOBY_AI_TIMEOUT_MS); the strict schema must refuse it outright.
    const response = await inject("PUT", "/api/settings/ai", {
      timeoutMs: 45_000,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe("SETTINGS_BODY_INVALID");
  });

  it("an empty PUT is a no-op write that answers the current view", async () => {
    const response = await inject("PUT", "/api/settings/ai", {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      model: { value: null, source: null },
      providers: [],
    });
  });
});

describe("settings api: catalog", () => {
  it("groups the chat models per provider, ids sorted", async () => {
    const response = await inject("GET", "/api/settings/ai/catalog");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providers: [{ id: "faux", models: ["faux-1", "faux-2"] }],
    });
  });
});

describe("settings api: AI test (POST /test)", () => {
  it("validates the body exactly like PUT: same 400 codes, zero writes", async () => {
    const fake = fakeProbe();
    await buildApp({ testProbe: fake.probe });
    for (const [body, code] of [
      [{ model: "nope" }, "SETTINGS_INVALID_MODEL"],
      [{ model: "FAUX/faux-1" }, "SETTINGS_INVALID_MODEL"],
      [
        { credentials: [{ provider: "unknown", apiKey: FULL_KEY }] },
        "SETTINGS_UNKNOWN_PROVIDER",
      ],
      [
        { credentials: [{ provider: "faux", apiKey: "" }] },
        "SETTINGS_INVALID_CREDENTIAL",
      ],
      [
        { credentials: [{ provider: "faux", apiKey: FULL_KEY, clear: true }] },
        "SETTINGS_INVALID_CREDENTIAL",
      ],
      [{ credentials: [{ provider: "faux" }] }, "SETTINGS_INVALID_CREDENTIAL"],
      [{ model: "faux/faux-1", extra: 1 }, "SETTINGS_BODY_INVALID"],
    ] as [Record<string, unknown>, string][]) {
      const response = await inject("POST", "/api/settings/ai/test", body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().errorCode, JSON.stringify(body)).toBe(code);
    }
    // The probe never ran and nothing landed anywhere.
    expect(fake.calls).toHaveLength(0);
    const get = await inject("GET", "/api/settings/ai");
    expect(get.json()).toEqual({
      model: { value: null, source: null },
      providers: [],
    });
  });

  it("an omitted model probes the effective model; null probes the env fallback", async () => {
    const fake = fakeProbe();
    // The environment configures faux/faux-2; the PUT below stores faux/faux-1.
    await buildApp({
      testProbe: fake.probe,
      env: { TOBY_AI_MODEL: "faux/faux-2" },
    });
    const stored = await inject("PUT", "/api/settings/ai", {
      model: "faux/faux-1",
    });
    expect(stored.statusCode).toBe(200);

    // Omitted model: the db row is effective.
    const omitted = await inject("POST", "/api/settings/ai/test", {});
    expect(omitted.statusCode).toBe(200);
    expect(omitted.json()).toMatchObject({
      stage: "ok",
      model: "faux/faux-1",
      reply: "OK",
    });

    // null model: PUT would delete the row, so the env fallback answers.
    const cleared = await inject("POST", "/api/settings/ai/test", {
      model: null,
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({
      stage: "ok",
      model: "faux/faux-2",
    });

    expect(fake.calls.map((call) => call.model)).toEqual([
      "faux/faux-1",
      "faux/faux-2",
    ]);
  });

  it("an unsaved apiKey reaches the probe as an overlay and nothing persists", async () => {
    const fake = fakeProbe();
    await buildApp({ testProbe: fake.probe });
    const response = await inject("POST", "/api/settings/ai/test", {
      model: "faux/faux-1",
      credentials: [{ provider: "faux", apiKey: FULL_KEY }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      stage: "ok",
      model: "faux/faux-1",
      latencyMs: expect.any(Number),
      reply: "OK",
      message: null,
    });
    expect(fake.calls[0]?.credentials).toEqual([
      { provider: "faux", apiKey: FULL_KEY },
    ]);
    // The full key never echoes back, and the settings view is untouched.
    expect(response.body).not.toContain(FULL_KEY);
    const get = await inject("GET", "/api/settings/ai");
    expect(get.json()).toEqual({
      model: { value: null, source: null },
      providers: [],
    });
  });

  it("probe failure stages arrive as 200 data, never HTTP errors", async () => {
    const outcomes: AiTestProbeOutcome[] = [
      {
        stage: "auth",
        model: "faux/faux-1",
        latencyMs: 5,
        reply: null,
        message: "not configured",
      },
      {
        stage: "timeout",
        model: "faux/faux-1",
        latencyMs: 50,
        reply: null,
        message: "AI request timed out",
      },
      {
        stage: "request-failed",
        model: "faux/faux-1",
        latencyMs: 9,
        reply: null,
        message: "boom",
      },
      {
        stage: "invalid-model",
        model: "faux/faux-1",
        latencyMs: null,
        reply: null,
        message: "gone",
      },
    ];
    for (const outcome of outcomes) {
      await buildApp({ testProbe: fakeProbe(outcome).probe });
      const response = await inject("POST", "/api/settings/ai/test", {
        model: "faux/faux-1",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(outcome);
    }
  });

  it("no model anywhere → unconfigured, the probe never runs", async () => {
    const fake = fakeProbe();
    await buildApp({ testProbe: fake.probe });
    const response = await inject("POST", "/api/settings/ai/test", {
      model: null,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      stage: "unconfigured",
      model: null,
      latencyMs: null,
      reply: null,
      message: null,
    });
    expect(fake.calls).toHaveLength(0);
  });
});
