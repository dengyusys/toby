/**
 * The registry-derived classifier: the prompt advertises exactly the
 * registered intents (plus "none"), and the output schema accepts only
 * those ids — an unregistered intent can neither be suggested nor
 * returned. Prompt frame, "none" line and fragment-folding rules are
 * chat's own and stay fixed. The `<memory>` conventions block rides
 * last, resolved per classify() call so it always carries the file's
 * current state; a corrupt memory file degrades to one honest line.
 */

import { describe, expect, it } from "vitest";
import { createIntentClassifier } from "../../src/domains/chat/intent.ts";
import type { AiClient } from "../../src/infrastructure/model/types.ts";
import type { ChatMemoryPort } from "../../src/domains/chat/types.ts";

/** A memory port whose classifier section is whatever the test set last. */
function makeMemoryPort(section: () => Promise<string>): {
  port: ChatMemoryPort;
  observeCalls: string[];
} {
  const observeCalls: string[] = [];
  return {
    port: {
      sectionFor: section,
      observeSession: (sessionId) => {
        observeCalls.push(sessionId);
      },
    },
    observeCalls,
  };
}

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
    // Without a memory port the `<memory>` block is absent entirely.
    expect(prompt).not.toContain("<memory>");
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

  it("carries the conventions as a <memory> block, last in the prompt", async () => {
    const { client, systemPrompts } = capturingClient({
      intent: "none",
      sentence: "hi",
    });
    const { port } = makeMemoryPort(async () => "## 约定\n- 咖啡记「饮品」");
    const classifier = createIntentClassifier({
      client,
      intents: descriptors,
      memory: port,
    });
    await classifier.classify("你好", []);

    const prompt = systemPrompts[0]!;
    expect(prompt).toContain("<memory>\n## 约定\n- 咖啡记「饮品」\n</memory>");
    // The block rides last — after the fixed rules, including the JSON
    // output rule. The classifier sees the same book the write agents do.
    expect(prompt.trimEnd().endsWith("</memory>")).toBe(true);
    expect(prompt.indexOf("</rules>")).toBeLessThan(prompt.indexOf("<memory>"));
    expect(prompt).not.toContain("记忆索引");
  });

  it("an empty section renders no <memory> block at all", async () => {
    const { client, systemPrompts } = capturingClient({
      intent: "none",
      sentence: "hi",
    });
    const { port } = makeMemoryPort(async () => "   ");
    const classifier = createIntentClassifier({
      client,
      intents: descriptors,
      memory: port,
    });
    await classifier.classify("你好", []);
    expect(systemPrompts[0]).not.toContain("<memory>");
  });

  it("a corrupt memory file degrades the block to one honest line", async () => {
    const { client, systemPrompts } = capturingClient({
      intent: "none",
      sentence: "hi",
    });
    const { port } = makeMemoryPort(async () => {
      throw new Error("MEMORY.md 第 3 行无法解析");
    });
    const classifier = createIntentClassifier({
      client,
      intents: descriptors,
      memory: port,
    });
    await classifier.classify("你好", []);
    expect(systemPrompts[0]).toContain(
      "<memory>\n（记忆文件当前无法读取）\n</memory>",
    );
  });

  it("the prompt is rebuilt per classify() call, so conventions stay fresh", async () => {
    const { client, systemPrompts } = capturingClient({
      intent: "none",
      sentence: "hi",
    });
    let conventions = "## 约定\n- 咖啡记「饮品」";
    const { port } = makeMemoryPort(async () => conventions);
    const classifier = createIntentClassifier({
      client,
      intents: descriptors,
      memory: port,
    });
    await classifier.classify("你好", []);
    // The user corrected a convention between turns; the next classify
    // must see the new file state, not a prompt frozen at construction.
    conventions = "## 约定\n- 咖啡记「饮品」\n- 周三聚餐";
    await classifier.classify("好的", []);
    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[0]).not.toContain("周三聚餐");
    expect(systemPrompts[1]).toContain("周三聚餐");
  });
});
