/**
 * Settings domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real sqlite in a fresh temporary directory per
 * case, injected clock, a faux pi-ai catalog). Pins the public shapes: the
 * effective AI view, the one transactional PUT with its per-code 400s, and
 * the catalog — plus the one rule that outranks everything: no response
 * ever carries a full key.
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

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;

async function buildApp(
  authProbe: (providerId: string) => Promise<boolean> = async () => false,
): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
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
            authProbe,
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
  method: "GET" | "PUT",
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
    await buildApp(async (id) => id === "faux");
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
