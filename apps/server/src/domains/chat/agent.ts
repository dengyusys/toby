/**
 * The `none`-intent agent (docs/features/chat.md): read-only tools,
 * bounded rounds, real data only, honest truncation notices — write
 * requests are gently declined, because writes belong to the business
 * intents. The toolset and rule snippets come from the registered
 * capabilities (src/chat-capability.ts); this file knows no domain name.
 * The run's verbatim pi-ai transcript travels back for zero-translation
 * items.
 */

import type { TobyAgentFactory } from "../../infrastructure/model/agent.ts";
import { localDayLabel } from "../../infrastructure/local-date.ts";
import type { Clock } from "../../infrastructure/clock.ts";
import type { ChatDomainCapability } from "../../chat-capability.ts";
import type { ChatAgent } from "./types.ts";

// Bounded on purpose: a query settles in a couple of tool rounds; more
// means the model is wandering.
const CHAT_AGENT_MAX_TURNS = 6;
const CHAT_AGENT_MAX_TOKENS = 2000;

export interface ChatAgentDeps {
  agentFactory: TobyAgentFactory;
  /** The registered capabilities; their tools and rules feed the agent. */
  capabilities: readonly ChatDomainCapability[];
  clock: Clock;
}

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { agentFactory, clock } = deps;
  const tools = deps.capabilities.flatMap((capability) => [
    ...capability.tools,
  ]);
  const domainRules = deps.capabilities.flatMap((capability) => [
    ...(capability.agentRules ?? []),
  ]);

  return {
    async run(prompt, history) {
      const now = new Date(clock());
      const agent = agentFactory({
        name: "chat-agent",
        preamble: "你是 Toby,一个私人助手,负责回答问题、查询数据和小聊。",
        rules: [
          "只用工具返回的真实数据回答,不编造;数据被截断就明说。",
          "用户想记录、安排或修改什么时,温和地说明自己只负责查询,建议把那句话直接说出来,系统会自动路由。",
          "回答用简洁的中文。",
          ...domainRules,
        ],
        context: [`今天是 ${localDayLabel(now)}。`],
        history,
        tools,
        policy: {
          allowedKinds: ["read-only"],
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
