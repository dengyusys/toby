/**
 * The `none`-intent agent (docs/features/chat.md): real data only, honest
 * truncation notices, and — since the memory domain landed — read-only
 * tools plus the memory write tools (docs/decisions/personal-agent-memory.md):
 * the agent may remember and forget, but business writes (ledger and the
 * rest) stay with their own intents. The toolset and rule snippets come
 * from the registered capabilities (src/chat-capability.ts); this file
 * knows no domain name. The run's verbatim pi-ai transcript travels back
 * for zero-translation items.
 */

import type { TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import {
  localDayLabel,
  resolveTimeZone,
} from "../../infrastructure/local-date.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type { ChatDomainCapability } from "../../chat-capability.ts";
import type { ChatAgent, ChatMemoryPort } from "./types.ts";

// Bounded on purpose: a query settles in a couple of tool rounds; more
// means the model is wandering.
const CHAT_AGENT_MAX_TURNS = 6;
const CHAT_AGENT_MAX_TOKENS = 2000;
/** Below this the gap line is noise; above it the pause must be visible. */
const GAP_CONTEXT_MIN_MS = 5 * 60_000;

export interface ChatAgentDeps {
  agentFactory: TobyAgentFactory;
  /** The registered capabilities; their tools feed the agent. */
  capabilities: readonly ChatDomainCapability[];
  /** The memory wiring port; its section feeds the prompt per run. */
  memory?: ChatMemoryPort;
  clock: Clock;
}

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { agentFactory, clock } = deps;
  const tools = deps.capabilities.flatMap((capability) => [
    ...capability.tools,
  ]);

  return {
    async run(prompt, history, timeZone) {
      const now = new Date(clock());
      const day = localDayLabel(now, resolveTimeZone(timeZone));
      const context = [`今天是 ${day}。`];
      // The window spans hours; without the gap stated, a reply after a
      // long pause reads as one continuous sitting.
      const last = history.at(-1);
      if (last && now.getTime() - last.timestamp >= GAP_CONTEXT_MIN_MS) {
        const minutes = Math.round((now.getTime() - last.timestamp) / 60_000);
        context.push(
          minutes < 60
            ? `距上一句对话约 ${minutes} 分钟。`
            : `距上一句对话约 ${Math.round(minutes / 60)} 小时。`,
        );
      }
      const agent = agentFactory({
        name: "chat-agent",
        preamble: "你是 Toby,一个私人助手,负责回答问题、查询数据和小聊。",
        rules: [
          "只用工具返回的真实数据回答,不编造;数据被截断就明说。",
          "记账这类业务写操作不在这里做,温和地说明把那句话直接说出来,系统会自动路由;但对话里出现的长期事实和约定(比如口味、习惯、称呼)可以随手记进记忆,过时的就删掉,记了会明说。",
          "回答用简洁的中文。",
          "需要列表、表格或代码时用 Markdown 表达,不要输出 HTML。",
        ],
        context,
        // Wrapped: chat keeps working with a corrupt memory file — the
        // section degrades to one honest line instead of failing the run.
        ...(deps.memory
          ? {
              memory: async () => {
                try {
                  return await deps.memory!.sectionFor();
                } catch {
                  return "（记忆文件当前无法读取）";
                }
              },
            }
          : {}),
        history,
        tools,
        policy: {
          // Chat widens to read-only + the memory write tools — the first
          // non-ledger write-intent agent
          // (docs/decisions/personal-agent-memory.md).
          allowedKinds: ["read-only", "write-intent"],
          maxTurns: CHAT_AGENT_MAX_TURNS,
        },
        maxTokens: CHAT_AGENT_MAX_TOKENS,
      });
      const result = await agent.run(prompt);
      return {
        text: result.text,
        messages: result.messages,
        producedMessages: result.producedMessages,
      };
    },
  };
}
