/**
 * Item synthesis: the one place chat constructs ChatItem values — the
 * minimal pi-ai shapes the service synthesizes itself (user text,
 * assistant text, notice), the card item from a capability's write
 * outcome, and the transcript/inspect items distilled from a none-agent
 * run. Shapes are the closed union in types.ts; reviewing how they can
 * legally be born happens here and nowhere else.
 */

import type {
  ChatDomainCapability,
  ChatWriteOutcome,
} from "../../chat-capability.ts";
import type { ChatItem } from "./types.ts";

/** The minimal well-formed pi-ai user message. */
export function userMessageItem(text: string, timestamp: number): ChatItem {
  return { role: "user", content: text, timestamp };
}

/** The minimal well-formed pi-ai assistant text message (zero usage). */
export function assistantTextItem(text: string, timestamp: number): ChatItem {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 0,
      output: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

export function noticeItem(text: string): ChatItem {
  return { type: "notice", text };
}

/** A write card from a capability's receipt outcome. */
export function cardItemOf(
  domain: string,
  outcome: Extract<ChatWriteOutcome, { kind: "receipt" }>,
): ChatItem {
  return {
    type: "proposal_card",
    domain,
    receipt: outcome.receipt,
  };
}

/** Transcript items from an agent run: assistant/toolResult verbatim, system dropped. */
export function transcriptItemsOf(messages: readonly unknown[]): ChatItem[] {
  return messages.flatMap((message) => {
    const role = (message as { role?: unknown }).role;
    // The run's own user messages duplicate what this turn already shows.
    return role === "assistant" || role === "toolResult"
      ? [message as ChatItem]
      : [];
  });
}

/**
 * A called tool's inspect target, whichever capability owns the tool:
 * first match wins (tool names are the capability's own namespace).
 */
function inspectTargetOf(
  capabilities: ReadonlyMap<string, ChatDomainCapability>,
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): { target: string; label: string } | undefined {
  for (const capability of capabilities.values()) {
    const target = capability.inspectTarget(toolName, args);
    if (target !== undefined) {
      return target;
    }
  }
  return undefined;
}

/** Deterministic inspect links for the read-only tools actually called. */
export function inspectLinksOf(
  messages: readonly unknown[],
  capabilities: ReadonlyMap<string, ChatDomainCapability>,
): ChatItem[] {
  const links: ChatItem[] = [];
  for (const message of messages) {
    if ((message as { role?: unknown }).role !== "assistant") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const record = block as Record<string, unknown>;
      if (record.type !== "toolCall" || typeof record.id !== "string") {
        continue;
      }
      const target = inspectTargetOf(
        capabilities,
        typeof record.name === "string" ? record.name : "",
        (record.arguments ?? {}) as Record<string, unknown>,
      );
      if (target !== undefined) {
        links.push({
          type: "inspect_link",
          source_tool_call_id: record.id,
          ...target,
        });
      }
    }
  }
  return links;
}
