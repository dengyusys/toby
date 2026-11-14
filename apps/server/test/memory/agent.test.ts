/**
 * The memory agent against a scripted fake agent factory: the spec's four
 * tools and both-kind policy, the per-run `<memory>` section (rendered
 * between rules and context, exempt from the tool-name check) and its
 * corrupt-file degrade, and the outcome mapping — receipts → receipt
 * outcome with the card envelope, a pending question → question outcome,
 * anything else → notice.
 */

import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import { createMemoryAgent } from "../../src/domains/memory/agent.ts";
import type { MemoryService } from "../../src/domains/memory/types.ts";
import { buildSystemPrompt } from "../../src/infrastructure/model/prompt.ts";
import type {
  TobyAgent,
  TobyAgentFactory,
  TobyAgentRunResult,
  TobyAgentSpec,
} from "../../src/infrastructure/model/agent.ts";

const SECTION_FIXTURE =
  "## 约定\n- 咖啡记「饮品」\n\n## 记忆索引 — 详情用 recall 工具查询\n人物: 小王";

function makeService(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    list: async () => ({ entries: [] }),
    exportMarkdown: async () => "",
    recall: async () => [],
    // The fake agent loop executes the real tools, so the tools DO call
    // these — each lands a fixed receipt the outcome tests can pin.
    remember: async (input) => ({
      kind: "receipt" as const,
      receipt: {
        action: "remembered" as const,
        type: input.type,
        after: `- ${input.text}`,
        created_at: "2026-11-14T08:00:00.000Z",
      },
    }),
    forget: async (keyword) => ({
      kind: "receipt" as const,
      receipt: {
        action: "forgot" as const,
        type: "约定" as const,
        before: `- 关于${keyword}`,
        created_at: "2026-11-14T08:00:00.000Z",
      },
    }),
    replaceExact: async () => {
      throw new Error("unused");
    },
    buildMemorySection: async () => SECTION_FIXTURE,
    observeSession: () => {},
    isOffRecord: () => false,
    getOffRecord: () => ({ sessionId: null, on: false }),
    setOffRecord: () => {},
    ...overrides,
  };
}

/** One scripted model action: a tool call against the real spec tools, or a final text. */
type Step =
  | { readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly text: string };

function assistantMessage(
  content: Message extends never ? never : unknown,
  timestamp: number,
): Message {
  return {
    role: "assistant",
    // The content rides as the message's content field, not spread — the
    // receipt scan reads `content[].toolCall` off assistant messages.
    content: content as Message["content"],
    model: "faux-1",
    api: "faux",
    provider: "faux",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  } as Message;
}

function makeFakeFactory(steps: readonly Step[]) {
  const specs: TobyAgentSpec[] = [];
  const factory: TobyAgentFactory = (spec) => {
    specs.push(spec);
    const toolsByName = new Map(
      spec.tools.map((entry) => [entry.tool.name, entry] as const),
    );
    const agent: TobyAgent = {
      async run(prompt: string): Promise<TobyAgentRunResult> {
        const messages: Message[] = [
          { role: "user", content: prompt, timestamp: 1 },
        ];
        let text = "";
        let callIndex = 0;
        for (const step of steps) {
          if ("text" in step) {
            text = step.text;
            break;
          }
          const entry = toolsByName.get(step.tool);
          if (!entry) {
            throw new Error(`fake loop: unregistered tool ${step.tool}`);
          }
          callIndex += 1;
          const id = `c${callIndex}`;
          messages.push(
            assistantMessage(
              [
                {
                  type: "toolCall",
                  id,
                  name: entry.tool.name,
                  arguments: step.args,
                },
              ],
              1 + callIndex,
            ),
          );
          const result = await entry.tool.execute(id, step.args as never);
          messages.push({
            role: "toolResult",
            toolCallId: id,
            toolName: entry.tool.name,
            content: result.content,
            details: result.details,
            isError: result.isError === true,
            timestamp: 1 + callIndex,
          });
        }
        return {
          text,
          turns: steps.length,
          turnCapped: false,
          stopReason: "stop" as const,
          messages,
          producedMessages: messages,
        };
      },
    };
    return agent;
  };
  return { factory, specs };
}

function makeAgent(steps: readonly Step[], service?: MemoryService) {
  const { factory, specs } = makeFakeFactory(steps);
  const agent = createMemoryAgent({
    agentFactory: factory,
    service: service ?? makeService(),
  });
  return { agent, specs };
}

describe("createMemoryAgent", () => {
  it("carries the four memory tools under a both-kinds policy", async () => {
    const { agent, specs } = makeAgent([{ text: "好" }]);
    await agent.run("这通别记");
    const spec = specs[0]!;
    expect(spec.name).toBe("memory-agent");
    expect(spec.tools.map((entry) => entry.tool.name)).toEqual([
      "recall",
      "remember",
      "forget",
      "off_record",
    ]);
    expect(spec.policy.allowedKinds).toEqual(["read-only", "write-intent"]);
    expect(spec.memory).toBeTypeOf("function");
  });

  it("the memory section provider renders conventions plus the index, exempt from the tool-name check", async () => {
    const { agent, specs } = makeAgent([{ text: "好" }]);
    await agent.run("你记得我什么");
    const spec = specs[0]!;
    const section = await (spec.memory as () => Promise<string>)();
    expect(section).toBe(SECTION_FIXTURE);
    // The index heading names recall — exactly why the <memory> section is
    // exempt from assertNoToolNames; the build must not throw.
    const prompt = buildSystemPrompt(spec, section);
    expect(prompt).toContain("<memory>");
    expect(prompt).toContain("## 记忆索引 — 详情用 recall 工具查询");
    // Between <rules> and whatever follows — the memory agent spec carries
    // no <context>, so the section closes the prompt.
    const rulesEnd = prompt.indexOf("</rules>");
    const memoryStart = prompt.indexOf("<memory>");
    expect(rulesEnd).toBeLessThan(memoryStart);
    expect(prompt.trimEnd().endsWith("</memory>")).toBe(true);
  });

  it("a corrupt memory file degrades the section to an honest line", async () => {
    const service = makeService({
      buildMemorySection: async () => {
        throw new Error("MEMORY.md 第 3 行无法解析");
      },
    });
    const { agent, specs } = makeAgent([{ text: "好" }], service);
    await agent.run("记住一件事");
    const section = await (specs[0]!.memory as () => Promise<string>)();
    expect(section).toBe("（记忆文件当前无法读取）");
  });

  it("landed receipts map to a receipt outcome with the card envelope", async () => {
    const { agent } = makeAgent([
      { tool: "remember", args: { type: "约定", text: "咖啡记「饮品」" } },
      { text: "记下了。" },
    ]);
    const { outcome, receipts } = await agent.run("记住咖啡记饮品");
    expect(receipts).toHaveLength(1);
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") {
      throw new Error("not a receipt");
    }
    expect(outcome.confirmText).toBe("记下了。");
    expect(outcome.receipt).toEqual({
      receipts: [
        {
          action: "remembered",
          type: "约定",
          after: "- 咖啡记「饮品」",
          created_at: "2026-11-14T08:00:00.000Z",
        },
      ],
    });
  });

  it("an overview recall rides as listed lines beside landed receipts", async () => {
    const service = makeService({
      recall: async () => [
        { type: "关于我", text: "不吃香菜", expired: false },
        { type: "人物", name: "小王", text: "房东", expired: false },
      ],
    });
    const { agent } = makeAgent(
      [
        { tool: "recall", args: {} },
        { tool: "remember", args: { type: "关于我", text: "在减脂" } },
        { text: "都记好了。" },
      ],
      service,
    );
    const { outcome } = await agent.run("记住我在减脂,再告诉我你记得什么");
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") {
      throw new Error("not a receipt");
    }
    expect(outcome.receipt).toEqual({
      receipts: [
        {
          action: "remembered",
          type: "关于我",
          after: "- 在减脂",
          created_at: "2026-11-14T08:00:00.000Z",
        },
      ],
      listed: ["- 不吃香菜", "- 小王: 房东"],
    });
  });

  it("a keyworded recall is not an overview: no listed lines", async () => {
    const service = makeService({
      recall: async () => [
        { type: "人物", name: "小王", text: "房东", expired: false },
      ],
    });
    const { agent } = makeAgent(
      [
        { tool: "recall", args: { keyword: "小王" } },
        {
          tool: "remember",
          args: { type: "人物", name: "小王", text: "球友" },
        },
        { text: "记好了。" },
      ],
      service,
    );
    const { outcome } = await agent.run("记住小王是球友");
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") {
      throw new Error("not a receipt");
    }
    expect(outcome.receipt).not.toHaveProperty("listed");
  });

  it("receipts with a silent model fall back to the receipt summary copy", async () => {
    const { agent } = makeAgent([
      { tool: "forget", args: { keyword: "拿铁" } },
      { text: "" },
    ]);
    const { outcome } = await agent.run("忘掉拿铁那条");
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") {
      throw new Error("not a receipt");
    }
    expect(outcome.confirmText).toBe("已清理：- 关于拿铁");
  });

  it("a run that ends with a pending question maps to the question outcome", async () => {
    const { agent } = makeAgent([{ text: "你说的是咖啡记「拿铁」那条吗?" }]);
    const { outcome, receipts } = await agent.run("改一下咖啡那条");
    expect(receipts).toEqual([]);
    expect(outcome).toEqual({
      kind: "question",
      text: "你说的是咖啡记「拿铁」那条吗?",
    });
  });

  it("a plain answer maps to a notice; silence gets the honest fallback", async () => {
    const { agent } = makeAgent([{ text: "你还没有让我记过东西。" }]);
    const answered = await agent.run("我记了什么");
    expect(answered.outcome).toEqual({
      kind: "notice",
      text: "你还没有让我记过东西。",
    });

    const silent = makeAgent([]);
    const empty = await silent.agent.run("嗯");
    expect(empty.outcome).toEqual({
      kind: "notice",
      text: "这次没有需要改动的记忆。",
    });
  });
});
