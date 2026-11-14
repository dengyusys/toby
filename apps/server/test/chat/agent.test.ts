/**
 * The chat agent's prompt: the runtime renders it from the spec — preamble,
 * generated <tools> lines, base rules plus each registered capability's
 * rule snippets, then the per-run <context>. Tool names appear only in the
 * generated section; the hand-written parts carry behaviour, so a renamed
 * tool cannot leave a stale name in prose. Since the memory domain landed,
 * the policy widens to read-only + write-intent (the memory write tools),
 * the silent-learning rule joins the base rules, and the `<memory>`
 * section resolves per run through the wiring port.
 */

import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createChatAgent } from "../../src/domains/chat/agent.ts";
import { defineTool } from "../../src/infrastructure/model/agent.ts";
import type { ChatDomainCapability } from "../../src/chat-capability.ts";
import type { ChatMemoryPort } from "../../src/domains/chat/types.ts";
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
    expect(prompt).toContain("回答用简洁的中文。");
    expect(prompt).toContain(
      "需要列表、表格或代码时用 Markdown 表达,不要输出 HTML。",
    );
    // The silent-learning rule: conversational memory writes ride the
    // none agent; business writes still route to their own intents.
    expect(prompt).toContain("可以随手记进记忆,过时的就删掉,记了会明说。");
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

  it("runs under a both-kinds policy: read-only queries plus the memory writes", async () => {
    specs.length = 0;
    const agent = createChatAgent({
      agentFactory,
      capabilities: [capability],
      clock,
    });
    await agent.run("查一下探针", []);
    const spec = specs[0]!;
    expect(spec.policy.allowedKinds).toEqual(["read-only", "write-intent"]);
    expect(spec.policy.maxTurns).toBe(6);
  });

  it("resolves the <memory> section per run, rendered between rules and context", async () => {
    specs.length = 0;
    let section =
      "## 约定\n- 咖啡记「饮品」\n\n## 记忆索引 — 详情用 recall 工具查询";
    const memory: ChatMemoryPort = {
      sectionForChat: async () => section,
      sectionForClassifier: async () => "",
      observeSession: () => {},
    };
    const agent = createChatAgent({
      agentFactory,
      capabilities: [capability],
      memory,
      clock,
    });
    await agent.run("你好", []);
    const spec = specs[0]!;
    expect(spec.memory).toBeTypeOf("function");

    const resolved = await (spec.memory as () => Promise<string>)();
    expect(resolved).toBe(section);
    // The index heading names recall — exactly why <memory> is exempt
    // from the tool-name check; the build must not throw.
    const prompt = buildSystemPrompt(spec, resolved);
    const rulesEnd = prompt.indexOf("</rules>");
    const memoryStart = prompt.indexOf("<memory>");
    const contextStart = prompt.indexOf("<context>");
    expect(rulesEnd).toBeGreaterThan(-1);
    expect(memoryStart).toBeGreaterThan(rulesEnd);
    expect(contextStart).toBeGreaterThan(memoryStart);
    expect(prompt).toContain("## 记忆索引 — 详情用 recall 工具查询");

    // Fresh per run: the file changed between turns, the next run sees it.
    section = "## 约定\n- 周三聚餐";
    await agent.run("又来了", []);
    expect(await (specs[1]!.memory as () => Promise<string>)()).toContain(
      "周三聚餐",
    );
  });

  it("an empty section renders no <memory> block; a corrupt file degrades honestly", async () => {
    specs.length = 0;
    const memory: ChatMemoryPort = {
      sectionForChat: async () => "",
      sectionForClassifier: async () => "",
      observeSession: () => {},
    };
    const agent = createChatAgent({
      agentFactory,
      capabilities: [capability],
      memory,
      clock,
    });
    await agent.run("你好", []);
    expect(buildSystemPrompt(specs[0]!, "")).not.toContain("<memory>");

    // The wrap lives in the spec's provider: chat keeps working with a
    // corrupt MEMORY.md — one honest line instead of a failed run.
    const corrupt: ChatMemoryPort = {
      ...memory,
      sectionForChat: async () => {
        throw new Error("MEMORY.md 第 3 行无法解析");
      },
    };
    const failing = createChatAgent({
      agentFactory,
      capabilities: [capability],
      memory: corrupt,
      clock,
    });
    await failing.run("你好", []);
    const degraded = await (specs[1]!.memory as () => Promise<string>)();
    expect(degraded).toBe("（记忆文件当前无法读取）");
    expect(buildSystemPrompt(specs[1]!, degraded)).toContain(
      "<memory>\n（记忆文件当前无法读取）\n</memory>",
    );
  });
});
