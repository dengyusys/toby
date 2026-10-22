/**
 * The Toby agent runtime over pi-agent-core (docs/decisions/ai-pi-runtime.md):
 * every tool is registered with a safety kind, and the agent's gate hook
 * enforces the policy derived from those kinds — a tool that is not
 * registered, or whose kind the agent's policy does not allow, never
 * executes. Runs are turn-capped and time-capped; usage lands in the
 * structured log. No business logic lives here: domains bring their own
 * tools.
 *
 * Kind semantics:
 * - "read-only":    no state change of any kind (queries, math, asking the
 *                   user a question).
 * - "write-intent": produces an effect, but only through a proposal — the
 *                   effect happens solely after user confirmation.
 * Prohibited capabilities (shell, file system, direct database access) are
 * not tools at all: they are absent by construction, not merely blocked.
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AssistantMessage,
  Models,
  Model,
  SimpleStreamOptions,
  StopReason,
  Usage,
} from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import type { AiRuntimeConfig } from "./types.ts";
import { AiError } from "./errors.ts";
import { textOf } from "./pi-ai-client.ts";
import type { Logger } from "../logging/logger.ts";

/** Safety classification every Toby tool must carry. */
export type ToolKind = "read-only" | "write-intent";

/** A pi-agent-core tool wrapped with its mandatory safety kind. */
export interface TobyTool {
  readonly kind: ToolKind;
  readonly tool: AgentTool;
}

/** Register a tool — the kind is not optional, by construction. */
export function defineTool<T extends TSchema>(
  kind: ToolKind,
  tool: AgentTool<T>,
): TobyTool {
  return { kind, tool };
}

export interface TobyAgentPolicy {
  /** Tool kinds this agent may execute; everything else is blocked. */
  readonly allowedKinds: readonly ToolKind[];
  /**
   * Hard cap on assistant turns — one turn = one assistant message,
   * including its tool calls and their results. Exceeding it ends the run.
   */
  readonly maxTurns: number;
}

export interface TobyAgentSpec {
  readonly systemPrompt: string;
  readonly tools: readonly TobyTool[];
  readonly policy: TobyAgentPolicy;
  /** Reply token budget forwarded to the provider request. */
  readonly maxTokens?: number;
}

export interface TobyAgentRunResult {
  /** Text content of the final assistant message ("" when none). */
  readonly text: string;
  readonly turns: number;
  /** True when the run ended because maxTurns was reached. */
  readonly turnCapped: boolean;
  /** Final stop reason; "none" when no assistant message was produced. */
  readonly stopReason: StopReason | "none";
  readonly usage?: Usage;
}

/** A prepared agent: one prompt in, a settled outcome out. */
export interface TobyAgent {
  run(prompt: string): Promise<TobyAgentRunResult>;
}

export type TobyAgentFactory = (spec: TobyAgentSpec) => TobyAgent;

export interface TobyAgentFactoryOptions {
  /** Injected in tests; defaults to the shared pi-ai model catalog. */
  readonly streamFn?: StreamFn;
  /**
   * Injected in tests — a models collection carrying pi-ai's faux provider
   * (its scripted fake provider); defaults to the shared builtin catalog.
   */
  readonly models?: Models;
  readonly logger?: Logger;
}

function createTobyAgent(
  catalog: Models,
  model: Model<string>,
  timeoutMs: number,
  injected: TobyAgentFactoryOptions,
  spec: TobyAgentSpec,
): TobyAgent {
  const toolByName = new Map(
    spec.tools.map((entry) => [entry.tool.name, entry] as const),
  );
  if (toolByName.size !== spec.tools.length) {
    throw new Error("duplicate tool name in agent spec");
  }

  return {
    async run(prompt: string): Promise<TobyAgentRunResult> {
      const logger = injected.logger;
      let turns = 0;
      let turnCapped = false;

      const agent = new Agent({
        initialState: {
          systemPrompt: spec.systemPrompt,
          model,
          tools: spec.tools.map((entry) => entry.tool),
        },
        // The default stream fn forwards the shared catalog's simple stream
        // with this spec's token budget; tests inject their own.
        streamFn:
          injected.streamFn ??
          ((streamedModel, context, options?: SimpleStreamOptions) =>
            catalog.streamSimple(streamedModel, context, {
              ...options,
              ...(spec.maxTokens !== undefined
                ? { maxTokens: spec.maxTokens }
                : {}),
            })),
        beforeToolCall: async (context) => {
          const name = context.toolCall.name;
          const entry = toolByName.get(name);
          // pi-agent-core rejects unknown tool names before this hook runs;
          // re-checking registration is a cheap invariant, the kind check
          // below is the gate's real job.
          if (!entry) {
            logger?.warn(
              { tool: name },
              "ai tool call blocked: not registered (invariant)",
            );
            return { block: true, reason: `unknown tool: ${name}` };
          }
          if (!spec.policy.allowedKinds.includes(entry.kind)) {
            logger?.warn(
              { tool: name, kind: entry.kind },
              "ai tool call blocked: kind not allowed by policy",
            );
            return {
              block: true,
              reason: `tool ${name} is not allowed in this agent`,
            };
          }
          logger?.info(
            { tool: name, kind: entry.kind },
            "ai tool call allowed",
          );
          return undefined;
        },
        finishTurn: () => {
          turns += 1;
          if (turns >= spec.policy.maxTurns) {
            turnCapped = true;
            return { action: "end" };
          }
          return undefined;
        },
      });

      const timer = setTimeout(() => agent.abort(), timeoutMs);
      try {
        // pi-agent-core resolves every failure into the transcript (the
        // assistant message carries stopReason error/aborted); prompt() does
        // not reject for a fresh Agent.
        await agent.prompt(prompt);
      } finally {
        clearTimeout(timer);
      }

      const assistant = [...agent.state.messages]
        .reverse()
        .find(
          (message): message is AssistantMessage =>
            message.role === "assistant",
        );
      const stopReason = assistant?.stopReason ?? "none";

      if (stopReason === "error") {
        const configured = await catalog
          .checkAuth(model.provider)
          .catch(() => undefined);
        throw configured
          ? new AiError(
              "request-failed",
              assistant?.errorMessage ?? "AI provider error",
            )
          : new AiError(
              "unconfigured",
              `AI provider "${model.provider}" is not configured: set its API key environment variable (see .env.example)`,
            );
      }
      if (stopReason === "aborted") {
        throw new AiError("timeout", "AI agent run timed out");
      }

      const usage = assistant?.usage;
      if (usage) {
        logger?.info(
          {
            model: model.id,
            provider: model.provider,
            turns,
            inTokens: usage.input,
            outTokens: usage.output,
            costUsd: usage.cost.total,
          },
          "ai agent run usage",
        );
      }
      return {
        text: textOf(assistant),
        turns,
        turnCapped,
        stopReason,
        ...(usage ? { usage } : {}),
      };
    },
  };
}

/**
 * Production agent factory: one shared model catalog, the model resolved
 * once at assembly (unknown provider/model pairs fail fast at startup).
 */
export function createTobyAgentFactory(
  config: AiRuntimeConfig,
  options: TobyAgentFactoryOptions = {},
): TobyAgentFactory {
  // One shared catalog per factory. Injected test models bypass the
  // builtin catalog; they serve the default stream fn and auth checks.
  const catalog = options.models ?? builtinModels();
  const [providerId, ...rest] = config.model.split("/");
  const modelId = rest.join("/");
  const resolved =
    providerId && modelId ? catalog.getModel(providerId, modelId) : undefined;
  if (!resolved) {
    throw new Error(
      `TOBY_AI_MODEL "${config.model}" is not a known provider/model pair in the pi-ai catalog`,
    );
  }
  return (spec) =>
    createTobyAgent(catalog, resolved, config.timeoutMs, options, spec);
}
