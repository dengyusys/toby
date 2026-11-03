/**
 * pi-ai transcript → trace messages. Defensive by design: the wire shape
 * (types.ts) is Toby's own, so a pi-ai release that changes its internals
 * degrades this normalizer to {role:"unknown"} entries instead of breaking
 * the monitor. Anything unexpected survives verbatim.
 */

import type {
  AssistantMessage,
  Message,
  SystemMessage,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  TraceMessage,
  TraceToolCall,
  TraceToolDeclaration,
  TraceUsage,
} from "./types.ts";

const UNRENDERABLE = "[unrenderable]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** View any block as a plain record (defensive reads on provider shapes). */
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Flatten content blocks (text or images) to text; images become a marker. */
function flattenText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return UNRENDERABLE;
  }
  return content
    .map((block): string => {
      if (!isRecord(block)) {
        return UNRENDERABLE;
      }
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if (block.type === "image") {
        return "[image]";
      }
      return UNRENDERABLE;
    })
    .join("\n");
}

export function traceUsage(usage: Usage | undefined): TraceUsage | undefined {
  if (!isRecord(usage) || typeof usage.totalTokens !== "number") {
    return undefined;
  }
  return {
    input: typeof usage.input === "number" ? usage.input : 0,
    output: typeof usage.output === "number" ? usage.output : 0,
    total_tokens: usage.totalTokens,
    cost_total:
      isRecord(usage.cost) && typeof usage.cost.total === "number"
        ? usage.cost.total
        : 0,
  };
}

function toolDeclarations(message: SystemMessage): TraceToolDeclaration[] {
  const added = message.toolsAdded;
  if (!Array.isArray(added)) {
    return [];
  }
  return added.flatMap((tool): TraceToolDeclaration[] => {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      return [];
    }
    return [
      {
        name: tool.name,
        ...(typeof tool.description === "string"
          ? { description: tool.description }
          : {}),
        ...(tool.parameters !== undefined
          ? { parameters: tool.parameters }
          : {}),
      },
    ];
  });
}

function toolCallsOf(message: AssistantMessage): TraceToolCall[] {
  const calls = (message.content ?? []).filter(
    (block) => isRecord(block) && block.type === "toolCall",
  );
  return calls.flatMap((block): TraceToolCall[] => {
    const record = asRecord(block);
    if (typeof record.id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [
      {
        id: record.id,
        name: record.name,
        arguments:
          record.arguments === undefined
            ? ""
            : JSON.stringify(record.arguments, null, 2),
      },
    ];
  });
}

/** Normalize one pi-ai message; anything unexpected survives as raw JSON. */
export function traceMessageOf(message: Message): TraceMessage {
  try {
    switch (message.role) {
      case "system": {
        const text = flattenText(message.content);
        const tools = toolDeclarations(message);
        return tools.length > 0
          ? { role: "system", text, tools }
          : { role: "system", text };
      }
      case "user":
        return { role: "user", text: flattenText(message.content) };
      case "assistant": {
        const blocks = message.content ?? [];
        const text = flattenText(
          blocks.filter((block) => !isRecord(block) || block.type === "text"),
        );
        const thinking = blocks
          .filter((block) => isRecord(block) && block.type === "thinking")
          .map((block) => {
            const record = asRecord(block);
            return typeof record.thinking === "string" ? record.thinking : "";
          })
          .join("\n");
        const usage = traceUsage(message.usage);
        return {
          role: "assistant",
          text,
          ...(thinking.length > 0 ? { thinking } : {}),
          tool_calls: toolCallsOf(message),
          ...(typeof message.stopReason === "string"
            ? { stop_reason: message.stopReason }
            : {}),
          ...(typeof message.durationMs === "number"
            ? { duration_ms: message.durationMs }
            : {}),
          ...(usage ? { usage } : {}),
        };
      }
      case "toolResult": {
        const toolName =
          typeof message.toolName === "string" ? message.toolName : "";
        return {
          role: "tool_result",
          tool_call_id:
            typeof message.toolCallId === "string" ? message.toolCallId : "",
          ...(toolName.length > 0 ? { tool_name: toolName } : {}),
          content: flattenText(message.content),
          ...(message.isError === true ? { is_error: true } : {}),
        };
      }
    }
  } catch {
    // Fall through to the raw record.
  }
  return { role: "unknown", raw: message };
}

export function traceMessagesOf(messages: readonly Message[]): TraceMessage[] {
  return messages.map(traceMessageOf);
}
