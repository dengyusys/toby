/**
 * Single-shot AI transport over pi-ai's unified API: one `complete()` call
 * per request, with the app-level JSON protocol (tolerant parsing, one
 * correction retry) kept on this side per docs/decisions/ai-pi-runtime.md.
 * It currently has no production caller — kept for the upcoming chat
 * domain (docs/features/chat.md), whose intent classification is its
 * expected first consumer. pi-ai never rejects — provider failures
 * arrive as the assistant message's stopReason/errorMessage and are mapped
 * onto the closed AiError union here. No business logic lives in this file.
 *
 * Timeout note: the timeout applies per request; a json() retry may span
 * two windows. The agent path (agent.ts) caps its whole run instead.
 */

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  Models,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  AiChatMessage,
  AiClient,
  AiRequestOptions,
  AiRuntimeConfig,
} from "./types.ts";
import { AiError, AI_UNCONFIGURED_MESSAGE } from "./errors.ts";
import { resolveCatalogModel } from "./catalog.ts";
import type { TraceReporter } from "../trace/types.ts";

/** The catalog-resolved model this client talks to. */
type ResolvedModel = Model<string>;

const RETRY_PROMPT =
  "Your previous reply was not valid JSON. Reply again with valid JSON only, no prose, no code fences.";

/** Tolerant JSON recovery: direct parse, then the outermost {...} slice. */
function parseJsonLoose(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Models sometimes wrap JSON in prose or ```json fences; the outermost
    // braces slice is the pragmatic recovery before a full retry.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("no JSON object found in the reply");
  }
}

/** Concatenate the text blocks of an assistant message ("" when absent). */
export function textOf(message: AssistantMessage | undefined): string {
  return (message?.content ?? [])
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/** Toby's restricted chat shape → pi-ai Context (system head + messages). */
function toContext(
  model: ResolvedModel,
  messages: readonly AiChatMessage[],
): Context {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  const rest: Message[] = messages
    .filter((message) => message.role !== "system")
    .map((message): Message => {
      if (message.role === "assistant") {
        // History replay only: the request path never sends assistant
        // turns today, so a minimal well-formed message is enough.
        return {
          role: "assistant",
          content: [{ type: "text", text: message.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp: Date.now(),
        };
      }
      return { role: "user", content: message.content, timestamp: Date.now() };
    });
  return {
    ...(system.length > 0 ? { systemPrompt: system.join("\n\n") } : {}),
    messages: rest,
  };
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Map a settled (non-ok) assistant message onto the AiError union. Auth
 * failures surface as plain error stop reasons, so the provider's auth
 * state is consulted to keep `unconfigured` (501) deterministic.
 */
async function mapFailure(
  models: Models,
  message: AssistantMessage,
  timedOut: boolean,
): Promise<AiError> {
  if (message.stopReason === "aborted" || timedOut) {
    return new AiError("timeout", "AI request timed out");
  }
  const configured = await models
    .checkAuth(message.provider)
    .catch(() => undefined);
  if (!configured) {
    return new AiError(
      "unconfigured",
      `AI provider "${message.provider}" is not configured: add its API key on the settings page or set its environment variable (see .env.example)`,
    );
  }
  return new AiError(
    "request-failed",
    message.errorMessage ?? `AI provider error (${message.stopReason})`,
  );
}

export function createPiAiClient(
  resolveConfig: () => Promise<AiRuntimeConfig | undefined>,
  options: { models?: Models; reporter?: TraceReporter } = {},
): AiClient {
  const models = options.models ?? builtinModels();
  const reporter = options.reporter;

  async function requestOnce(
    messages: readonly AiChatMessage[],
    options?: AiRequestOptions,
  ): Promise<string> {
    // Per-request config resolution: the settings database wins over the
    // environment, so a change lands on the very next call. No caching
    // layer: two SQLite point reads are noise next to a seconds-long model
    // call — exact semantics beat a cache.
    const config = await resolveConfig();
    if (config === undefined) {
      throw new AiError("unconfigured", AI_UNCONFIGURED_MESSAGE);
    }
    const model: ResolvedModel = resolveCatalogModel(models, config.model);
    const capture = reporter?.begin({
      kind: "single-shot",
      label: "complete",
      model: model.id,
      prompt:
        [...messages].reverse().find((message) => message.role === "user")
          ?.content ?? "",
    });
    // The trace transcript replays pi-ai shapes verbatim: the request's
    // messages are rebuilt as minimal well-formed pi-ai messages and the
    // provider's reply joins them as-is.
    const conversation = (): Message[] =>
      messages.map((message): Message => {
        const timestamp = Date.now();
        if (message.role === "assistant") {
          // History replay only: the request path never sends assistant
          // turns today, so a minimal well-formed message is enough.
          return {
            role: "assistant",
            content: [{ type: "text", text: message.content }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: ZERO_USAGE,
            stopReason: "stop",
            timestamp,
          };
        }
        if (message.role === "system") {
          return { role: "system", content: message.content, timestamp };
        }
        return { role: "user", content: message.content, timestamp };
      });

    const signal = AbortSignal.timeout(config.timeoutMs);
    const reply = await models.complete(model, toContext(model, messages), {
      maxTokens: options?.maxTokens,
      temperature: options?.temperature ?? 0,
      signal,
    });
    const transcript = (): Message[] => [...conversation(), reply];

    try {
      if (reply.stopReason === "error" || reply.stopReason === "aborted") {
        throw await mapFailure(models, reply, signal.aborted);
      }
      const text = textOf(reply);
      if (text.length === 0) {
        throw new AiError(
          "request-failed",
          "AI provider returned no message content",
        );
      }
      capture?.finish({
        status: "succeeded",
        messages: transcript(),
        result_text: text,
        stopReason: reply.stopReason,
      });
      return text;
    } catch (error) {
      capture?.finish({
        status: "failed",
        messages: transcript(),
        error: error instanceof Error ? error.message : String(error),
        stopReason: reply.stopReason,
      });
      throw error;
    }
  }

  return {
    async json(messages, options) {
      try {
        return parseJsonLoose(await requestOnce(messages, options));
      } catch (error) {
        if (error instanceof AiError) {
          throw error;
        }
        // One full retry with an explicit correction prompt, then fail
        // plainly — no guessing, no silent drops.
        try {
          return parseJsonLoose(
            await requestOnce(
              [...messages, { role: "user", content: RETRY_PROMPT }],
              options,
            ),
          );
        } catch (retryError) {
          if (retryError instanceof AiError) {
            throw retryError;
          }
          throw new AiError(
            "unparseable-output",
            "AI reply was not parseable JSON after one retry",
            retryError,
          );
        }
      }
    },

    text(messages, options) {
      return requestOnce(messages, options);
    },
  };
}
