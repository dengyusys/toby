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
import type {
  AgentOptions,
  AgentTool,
  StreamFn,
} from "@earendil-works/pi-agent-core";
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
import { resolveCatalogModel } from "./model-catalog.ts";
import { textOf } from "./pi-ai-client.ts";
import type { Logger } from "@nestjs/common";

/** Safety classification every Toby tool must carry. */
export type ToolKind = "read-only" | "write-intent";

/** A pi-agent-core tool wrapped with its mandatory safety kind. */
export interface TobyTool {
  readonly kind: ToolKind;
  readonly tool: AgentTool;
}

/** Wrap a tool with its mandatory safety kind. */
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

type ToolGateHook = NonNullable<AgentOptions["beforeToolCall"]>;

/**
 * The kind gate: registered tools only, and only kinds the policy allows.
 * Unknown names are rejected by pi-agent-core before this hook runs, so
 * the registration branch is an invariant, not the real defense.
 */
function createToolGate(
  spec: TobyAgentSpec,
  logger: Logger | undefined,
): ToolGateHook {
  const toolByName = new Map(
    spec.tools.map((entry) => [entry.tool.name, entry] as const),
  );
  return async (context) => {
    const name = context.toolCall.name;
    const entry = toolByName.get(name);
    if (!entry) {
      logger?.warn("ai tool call blocked: not registered", { tool: name });
      return { block: true, reason: `unknown tool: ${name}` };
    }
    if (!spec.policy.allowedKinds.includes(entry.kind)) {
      logger?.warn("ai tool call blocked: kind not allowed by policy", {
        tool: name,
        kind: entry.kind,
      });
      return {
        block: true,
        reason: `tool ${name} is not allowed in this agent`,
      };
    }
    logger?.log("ai tool call allowed", { tool: name, kind: entry.kind });
    return undefined;
  };
}

/**
 * Map a provider-failure stop reason onto the AiError union. Auth failures
 * surface as plain errors, so the provider's auth state is consulted to
 * keep `unconfigured` (501) deterministic.
 */
async function throwForProviderFailure(
  catalog: Models,
  model: Model<string>,
  assistant: AssistantMessage | undefined,
): Promise<never> {
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
        // with this spec's token budget.
        streamFn:
          injected.streamFn ??
          ((streamedModel, context, options?: SimpleStreamOptions) =>
            catalog.streamSimple(streamedModel, context, {
              ...options,
              ...(spec.maxTokens !== undefined
                ? { maxTokens: spec.maxTokens }
                : {}),
            })),
        beforeToolCall: createToolGate(spec, logger),
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
        await throwForProviderFailure(catalog, model, assistant);
      }
      if (stopReason === "aborted") {
        throw new AiError("timeout", "AI agent run timed out");
      }

      const usage = assistant?.usage;
      if (usage) {
        logger?.log("ai agent run usage", {
          model: model.id,
          provider: model.provider,
          turns,
          inTokens: usage.input,
          outTokens: usage.output,
          costUsd: usage.cost.total,
        });
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
  // Injected test models serve the default stream fn and auth checks.
  const catalog = options.models ?? builtinModels();
  const resolved = resolveCatalogModel(catalog, config.model);
  return (spec) =>
    createTobyAgent(catalog, resolved, config.timeoutMs, options, spec);
}
