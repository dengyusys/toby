/**
 * The chat agent's prompt: the runtime renders it from the spec — preamble,
 * generated <tools> lines, base rules plus each registered capability's
 * rule snippets, then the per-run <context>. Tool names appear only in the
 * generated section; the hand-written parts carry behaviour, so a renamed
 * tool cannot leave a stale name in prose.
 */

import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createChatAgent } from "../../src/domains/chat/agent.ts";
import { defineTool } from "../../src/infrastructure/model/agent.ts";
import type { ChatDomainCapability } from "../../src/chat-capability.ts";
import type {
  TobyAgentFactory,
  TobyAgentSpec,
} from "../../src/infrastructure/model/agent.ts";
import { buildSystemPrompt } from "../../src/infrastructure/model/prompt.ts";

const specs: TobyAgentSpec[] = [];

const agentFactory: TobyAgentFactory = (spec) => {
  specs.push(spec);
  return {
    async run() {
      return {
        text: "ok",
        turns: 1,
        turnCapped: false,
        stopReason: "stop" as const,
        messages: [],
        producedMessages: [{ role: "user", content: "fresh", timestamp: 0 }],
      };
    },
  };
};

const probe = defineTool("read-only", {
  name: "probe_lookup",
  label: "探针",
  description: "测试用工具。",
  promptSnippet: "查一个测试值",
  promptGuidelines: ["先查再答。"],
  parameters: z.object({ key: z.string() }).strict(),
  execute: async () => ({
    content: [{ type: "text" as const, text: "probe" }],
    details: {},
  }),
});

const capability: ChatDomainCapability = {
  intent: "probe",
  label: "探针域",
  intentDescription: "- probe(探针):测试用。",
  handleWrite: async () => ({ kind: "notice", text: "noop" }),
  tools: [probe],
  agentRules: ["探针数据只作展示,不外传。"],
  inspectTarget: () => undefined,
};

const clock = () => new Date(2026, 10, 6, 12, 0, 0).getTime();

describe("createChatAgent", () => {
  it("composes toolset and rules from the registered capabilities", async () => {
    specs.length = 0;
    const agent = createChatAgent({
      agentFactory,
      capabilities: [capability],
      clock,
    });
    const run = await agent.run("查一下探针", []);
    // The runtime's own-transcript field rides through untouched: turn
    // items are built from it downstream.
    expect(run.producedMessages).toEqual([
      { role: "user", content: "fresh", timestamp: 0 },
    ]);

    const spec = specs[0]!;
    expect(spec.tools.map((entry) => entry.tool.name)).toEqual([
      "probe_lookup",
    ]);

    const prompt = buildSystemPrompt(spec);
    expect(prompt).toContain("- probe_lookup：查一个测试值");
    // The ordering note rides under the tool that starts the chain.
    expect(prompt).toContain(
      "<tools>\n- probe_lookup：查一个测试值\n  - 先查再答。",
    );
    expect(prompt).toContain("<rules>");
    // Base rules and the capability's snippet land together, base first.
    expect(prompt).toContain("回答用简洁的中文。");
    expect(prompt).toContain("探针数据只作展示,不外传。");
    expect(prompt).toContain(
      "<context>\n今天是 2026-11-06(星期五)。\n</context>",
    );

    // Hand-written sections never name a tool; <tools> is the one place
    // that does, and it is generated.
    const prose = [
      spec.preamble,
      ...(spec.rules ?? []),
      ...(spec.context ?? []),
    ].join("\n");
    for (const entry of spec.tools) {
      expect(prose).not.toContain(entry.tool.name);
    }
  });
});
