/**
 * The memory chat capability: identity and classifier line, the two
 * conversational tools it exposes (off_record stays memory-agent-only),
 * the write path through the memory agent (and the AI-unconfigured
 * notice without one), the in-run card mapping (receipt quoted verbatim,
 * nothing cardable answers undefined), and inspectTarget answering
 * undefined for every tool — memory has no preview panel.
 */

import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import { createMemoryChatCapability } from "../../src/domains/memory/chat-capability.ts";
import { createMemoryTools } from "../../src/domains/memory/tools.ts";
import type {
  MemoryOffRecordState,
  MemoryService,
} from "../../src/domains/memory/types.ts";
import type {
  TobyAgent,
  TobyAgentFactory,
  TobyAgentRunResult,
  TobyAgentSpec,
  TobyTool,
} from "../../src/infrastructure/model/agent.ts";

function makeService(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    readFile: async () => "",
    // The agent's scripted steps execute the real tools, so the tools do
    // call these; each lands a fixed receipt the tests can pin.
    remember: async (input) => ({
      kind: "receipt" as const,
      receipt: {
        action: "remembered" as const,
        section: input.section,
        after: `- ${input.text}`,
        created_at: "2026-11-14T08:00:00.000Z",
      },
    }),
    forget: async (keyword) => ({
      kind: "receipt" as const,
      receipt: {
        action: "forgot" as const,
        section: "约定" as const,
        before: `- 关于${keyword}`,
        created_at: "2026-11-14T08:00:00.000Z",
      },
    }),
    resetMemory: async () => ({ reset_at: "2026-11-14T08:00:00.000Z" }),
    buildMemorySection: async () => "",
    observeSession: () => {},
    isOffRecord: () => false,
    getOffRecord: (): MemoryOffRecordState => ({ sessionId: null, on: false }),
    setOffRecord: () => {},
    ...overrides,
  };
}

function assistantMessage(content: unknown, timestamp: number): Message {
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

/** One scripted model action: a real tool call, or a final text. */
type Step =
  | { readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly text: string };

function makeFakeFactory(steps: readonly Step[]) {
  const specs: TobyAgentSpec[] = [];
  const factory: TobyAgentFactory = (spec) => {
    specs.push(spec);
    const toolsByName = new Map<string, TobyTool>(
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
              {
                type: "toolCall",
                id,
                name: entry.tool.name,
                arguments: step.args,
              },
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

function makeCapability(steps: readonly Step[] = [{ text: "好" }]) {
  const service = makeService();
  const tools = createMemoryTools({ service });
  const { factory, specs } = makeFakeFactory(steps);
  const capability = createMemoryChatCapability({
    service,
    tools,
    agentFactory: factory,
  });
  return { capability, service, tools, specs };
}

describe("createMemoryChatCapability", () => {
  it("carries the memory identity and one classifier line", () => {
    const { capability } = makeCapability();
    expect(capability.intent).toBe("memory");
    expect(capability.label).toBe("记忆");
    expect(capability.intentDescription).toContain("- memory(记忆):");
    expect(capability.intentDescription).toContain("你记得我什么");
    expect(capability.intentDescription).toContain("这通别记");
  });

  it("exposes exactly the two conversational tools — off_record stays agent-only", () => {
    const { capability } = makeCapability();
    expect(capability.tools.map((tool) => tool.tool.name)).toEqual([
      "remember",
      "forget",
    ]);
    expect(capability.tools.map((tool) => tool.tool.name)).not.toContain(
      "off_record",
    );
  });

  it("maps the agent's run onto the write outcome verbatim", async () => {
    const { capability } = makeCapability([
      {
        tool: "remember",
        args: { section: "约定", text: "咖啡记「饮品」" },
      },
      { text: "记好了。" },
    ]);
    const outcome = await capability.handleWrite("记住咖啡记饮品");
    expect(outcome).toEqual({
      kind: "receipt",
      confirmText: "记好了。",
      receipt: {
        receipts: [
          {
            action: "remembered",
            section: "约定",
            after: "- 咖啡记「饮品」",
            created_at: "2026-11-14T08:00:00.000Z",
          },
        ],
      },
    });
  });

  it("without an agentFactory the write answers the AI-unconfigured notice", async () => {
    const service = makeService();
    const capability = createMemoryChatCapability({
      service,
      tools: createMemoryTools({ service }),
    });
    const outcome = await capability.handleWrite("记住一件事");
    expect(outcome).toEqual({
      kind: "notice",
      text: 'AI is not configured: set TOBY_AI_MODEL to a "provider/model" pair (e.g. "zai/glm-4.7")',
    });
  });

  it("cardFor quotes the receipt verbatim, one copy per action", () => {
    const { capability } = makeCapability();
    const remembered = {
      action: "remembered" as const,
      section: "约定" as const,
      after: "- 咖啡记「饮品」",
      created_at: "2026-11-14T08:00:00.000Z",
    };
    expect(capability.cardFor?.("remember", { receipt: remembered })).toEqual({
      confirmText: "已记住：- 咖啡记「饮品」",
      receipt: remembered,
    });
    const updated = {
      action: "updated" as const,
      section: "约定" as const,
      before: "- 咖啡记「拿铁」",
      after: "- 咖啡记「饮品」",
      created_at: "2026-11-14T08:00:00.000Z",
    };
    expect(capability.cardFor?.("remember", { receipt: updated })).toEqual({
      confirmText: "已更新：- 咖啡记「饮品」",
      receipt: updated,
    });
    const forgot = {
      action: "forgot" as const,
      section: "约定" as const,
      before: "- 关于拿铁",
      created_at: "2026-11-14T08:00:00.000Z",
    };
    expect(capability.cardFor?.("forget", { receipt: forgot })).toEqual({
      confirmText: "已清理：- 关于拿铁",
      receipt: forgot,
    });
  });

  it("cardFor answers undefined for other tools and receipt-less results", () => {
    const { capability } = makeCapability();
    // Not a memory write tool.
    expect(capability.cardFor?.("off_record", { on: true })).toBeUndefined();
    expect(
      capability.cardFor?.("ledger_month_report", { count: 1 }),
    ).toBeUndefined();
    // A memory write tool without a landed receipt (refusal, ambiguity).
    expect(capability.cardFor?.("remember", {})).toBeUndefined();
    expect(capability.cardFor?.("forget", null)).toBeUndefined();
    expect(capability.cardFor?.("remember", undefined)).toBeUndefined();
  });

  it("memory has no preview panel: inspectTarget answers undefined", () => {
    const { capability } = makeCapability();
    for (const tool of capability.tools) {
      expect(capability.inspectTarget(tool.tool.name, {})).toBeUndefined();
      expect(
        capability.inspectTarget(tool.tool.name, { keyword: "咖啡" }),
      ).toBeUndefined();
    }
  });
});
