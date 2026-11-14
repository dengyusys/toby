/**
 * Production AI wiring regression: the composition root must hand the
 * settings domain's credential-carrying Models instance to BOTH runtime
 * transports (the agent factory and the single-shot client), so a key
 * saved on the settings page reaches every provider call. The pinned
 * regression: both factories silently fell back to a bare builtinModels()
 * whose credentials come only from the environment — with the key stored
 * only in data/settings.db, every chat send degraded to the unconfigured
 * notice. The test drives the REAL production composition in-process
 * (createApp + productionDomains through the shared fixture app), with
 * the createModels seam mounting the only fake: a credential-aware faux
 * provider whose completion calls are captured. No real AI; a fresh
 * temporary data root per case.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { productionDomains } from "../apps/server/src/composition-root.ts";
import { resolveConfig } from "../apps/server/src/infrastructure/config/config.ts";
import { createFauxCatalog } from "../apps/server/test/ai-wiring-fixture.ts";
import { createTestApp } from "../apps/server/test/app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-ai-wiring-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const STORED_KEY = "sk-stored-integration-key-9876";
const AGENT_REPLY = "Ahoy! All systems nominal.";

const faux = createFauxCatalog();

let app: Awaited<ReturnType<typeof createTestApp>>;
let caseCounter = 0;

beforeEach(async () => {
  caseCounter += 1;
  faux.reset();
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  app = await createTestApp({
    config,
    domains: productionDomains({ config, createModels: faux.seam }),
  });
});

afterEach(async () => {
  await app.close();
});

describe("production ai wiring (composition root)", () => {
  it("a saved model + key reaches every provider call; the chat turn settles with a real reply", async () => {
    // The settings-page write: model + provider key land in the settings
    // database (data/settings.db), nowhere near the environment.
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/ai",
      payload: {
        model: "faux/faux-1",
        credentials: [{ provider: "faux", apiKey: STORED_KEY }],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      model: { value: "faux/faux-1", source: "db" },
      providers: [{ id: "faux", source: "stored", maskedKey: "sk-…9876" }],
    });

    // One chat send crosses the real production composition twice: the
    // intent classifier (single-shot JSON), then the none-agent's reply.
    faux.script('{"intent":"none","sentence":"hello there"}');
    faux.script(AGENT_REPLY);

    const sent = await app.inject({
      method: "POST",
      url: "/api/chat/messages",
      payload: { text: "hello there" },
    });
    expect(sent.statusCode).toBe(200);
    const turn = sent.json() as { items: { role?: string }[] };

    // The turn settled with a real reply — never the unconfigured notice.
    const rendered = JSON.stringify(turn.items);
    expect(rendered).toContain(AGENT_REPLY);
    expect(rendered).not.toContain("AI is not configured");
    const assistantItems = turn.items.filter(
      (item) => item.role === "assistant",
    );
    expect(assistantItems.length).toBeGreaterThanOrEqual(1);

    // And the STORED key rode on EVERY provider call: the settings
    // domain's credential store reached both runtime transports. (Before
    // the fix the factories built a bare builtinModels() — no faux
    // provider, no stored key — so both this and the reply assertion fail.)
    expect(faux.receivedApiKeys.length).toBeGreaterThanOrEqual(2);
    for (const apiKey of faux.receivedApiKeys) {
      expect(apiKey).toBe(STORED_KEY);
    }
  });
});
