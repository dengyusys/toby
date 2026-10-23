/**
 * Single-shot pi-ai transport against a scripted faux provider: system
 * prompt mapping, tolerant JSON recovery, the single parse retry, and the
 * AiError mapping (error stop reasons consult provider auth, aborts are
 * timeouts). Automated tests never touch a real model.
 */

import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
} from "@earendil-works/pi-ai/providers/faux";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { AiError } from "../../src/infrastructure/ai/errors.ts";
import { caught } from "../helpers.ts";
import { createPiAiClient } from "../../src/infrastructure/ai/pi-ai-client.ts";

const TIMEOUT_MS = 5_000;

function makeHarness() {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const client = createPiAiClient(
    { model: "faux/faux-1", timeoutMs: TIMEOUT_MS },
    { models },
  );
  return { client, faux };
}

describe("createPiAiClient", () => {
  it("completes text and carries the system message into the transcript", async () => {
    const { client, faux } = makeHarness();
    let seenContext: unknown;
    faux.appendResponses([
      (context) => {
        seenContext = context;
        return fauxAssistantMessage("hello there");
      },
    ]);
    const reply = await client.text([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(reply).toBe("hello there");
    // pi-ai normalizes the system prompt into a leading transcript message.
    const context = seenContext as {
      messages: { role: string; content: unknown }[];
    };
    const system = context.messages.find(
      (message) => message.role === "system",
    );
    expect(JSON.stringify(system)).toContain("be brief");
    expect(context.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("recovers JSON buried in prose via the braces slice, without a retry", async () => {
    const { client, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage('Sure! Here you go: {"ok": true} hope that helps'),
    ]);
    expect(await client.json([{ role: "user", content: "x" }])).toEqual({
      ok: true,
    });
    expect(faux.state.callCount).toBe(1);
  });

  it("maps an empty reply to request-failed", async () => {
    const { client, faux } = makeHarness();
    faux.appendResponses([fauxAssistantMessage(fauxText("").text)]);
    const error = await caught(client.text([{ role: "user", content: "x" }]));
    expect(error.code).toBe("request-failed");
  });

  it("recovers JSON wrapped in code fences without a retry", async () => {
    const { client, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage('```json\n{"entries": []}\n```'),
    ]);
    expect(await client.json([{ role: "user", content: "x" }])).toEqual({
      entries: [],
    });
    expect(faux.state.callCount).toBe(1);
  });

  it("retries exactly once with a correction prompt on unparseable output", async () => {
    const { client, faux } = makeHarness();
    const prompts: string[] = [];
    let call = 0;
    faux.appendResponses([
      (context) => {
        call += 1;
        prompts.push(
          context.messages.map((message) => JSON.stringify(message)).join("\n"),
        );
        return fauxAssistantMessage("not json at all");
      },
      (context) => {
        call += 1;
        prompts.push(
          context.messages.map((message) => JSON.stringify(message)).join("\n"),
        );
        return fauxAssistantMessage('{"ok": true}');
      },
    ]);
    expect(await client.json([{ role: "user", content: "x" }])).toEqual({
      ok: true,
    });
    expect(call).toBe(2);
    // The retry carries the original exchange plus the correction prompt.
    expect(prompts[1]).toContain("not valid JSON");
  });

  it("fails with unparseable-output after the single retry", async () => {
    const { client, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage("garbage"),
      fauxAssistantMessage(fauxText("still garbage").text),
    ]);
    const error = await caught(client.json([{ role: "user", content: "x" }]));
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("unparseable-output");
    expect(faux.state.callCount).toBe(2);
  });

  it("maps an error stop reason with resolvable auth to request-failed", async () => {
    const { client, faux } = makeHarness();
    faux.appendResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" }),
    ]);
    // The faux provider's auth resolves, so the failure is a plain 502.
    const error = await caught(client.text([{ role: "user", content: "x" }]));
    expect(error.code).toBe("request-failed");
    expect(error.message).toContain("boom");
  });

  it("maps an error on a provider with no credentials to unconfigured", async () => {
    // The real zai provider with no ZAI_API_KEY in the environment: the
    // request fails before any network I/O and the auth check maps the
    // failure onto the 501-flavored code.
    const models = createModels();
    models.setProvider(zaiProvider());
    const client = createPiAiClient(
      { model: "zai/glm-4.7", timeoutMs: TIMEOUT_MS },
      { models },
    );
    const error = await caught(client.text([{ role: "user", content: "x" }]));
    expect(error.code).toBe("unconfigured");
  });

  it("maps an aborted run (timeout) to the timeout code", async () => {
    const models = createModels();
    const faux = fauxProvider({ tokensPerSecond: 100 });
    models.setProvider(faux.provider);
    const client = createPiAiClient(
      // Long text at ~40 ms per chunk cannot finish inside 50 ms.
      { model: "faux/faux-1", timeoutMs: 50 },
      { models },
    );
    faux.appendResponses([fauxAssistantMessage("word ".repeat(200))]);
    const error = await caught(client.text([{ role: "user", content: "x" }]));
    expect(error.code).toBe("timeout");
  });

  it("rejects unknown provider/model pairs at construction", () => {
    expect(() =>
      createPiAiClient({ model: "nope/not-a-model", timeoutMs: TIMEOUT_MS }),
    ).toThrow(/provider\/model/);
  });
});
