/**
 * The registry-derived classifier: the prompt advertises exactly the
 * registered intents (plus "none"), and the output schema accepts only
 * those ids — an unregistered intent can neither be suggested nor
 * returned. Prompt frame, "none" line and fragment-folding rules are
 * chat's own and stay fixed.
 */

import { describe, expect, it } from "vitest";
import { createIntentClassifier } from "../../src/domains/chat/intent.ts";
import type { AiClient } from "../../src/infrastructure/model/types.ts";

/** Captures the system prompt; replies with a scripted object. */
function capturingClient(reply: unknown): {
  client: AiClient;
  systemPrompts: string[];
} {
  const systemPrompts: string[] = [];
  const client: AiClient = {
    json: async (messages) => {
      const system = messages.find((message) => message.role === "system");
      if (system) systemPrompts.push(system.content);
      return reply;
    },
    text: async () => "",
  };
  return { client, systemPrompts };
}

const descriptors = [
  {
    intent: "ledger",
    intentDescription: "- ledger(记账):记一笔钱、查账、问花了多少。",
  },
];

describe("createIntentClassifier (registry-derived)", () => {
  it("advertises exactly the registered intents plus none", async () => {
    const { client, systemPrompts } = capturingClient({
      intent: "ledger",
      sentence: "午饭 30",
    });
    const classifier = createIntentClassifier({ client, intents: descriptors });
    const result = await classifier.classify("午饭 30", []);
    expect(result).toEqual({ intent: "ledger", sentence: "午饭 30" });

    const prompt = systemPrompts[0]!;
    expect(prompt).toContain("意图说明:");
    expect(prompt).toContain("- ledger(记账):记一笔钱、查账、问花了多少。");
    expect(prompt).toContain("- none(其他):闲聊、提问、以及上面都不属于的话。");
    // Unregistered intents are not advertised to the model.
    expect(prompt).not.toContain("schedule");
    expect(prompt).not.toContain("memory");
  });

  it("rejects an intent the registry never registered", async () => {
    const { client } = capturingClient({
      intent: "schedule",
      sentence: "安排一下",
    });
    const classifier = createIntentClassifier({ client, intents: descriptors });
    // A model cannot return an id it was never shown; if it does anyway,
    // schema validation fails and the caller takes the honest fallback.
    await expect(classifier.classify("安排一下", [])).rejects.toThrow(
      "classification output failed schema validation",
    );
  });
});
