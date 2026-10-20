/**
 * OpenAI-compatible chat transport: plain fetch against any provider that
 * speaks the /chat/completions dialect (deliberately no vendor SDK — see
 * PLAN's dependency rules). Handles auth, timeout, error mapping, and the
 * one parse-retry for JSON output. No business logic lives here.
 */

import { AiError } from "./errors.ts";
import type {
  AiChatMessage,
  AiClient,
  AiRequestOptions,
  AiTransportConfig,
} from "./types.ts";

interface ChatCompletionBody {
  model: string;
  messages: AiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream: false;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

const RETRY_PROMPT =
  "Your previous reply was not valid JSON. Reply again with valid JSON only, no prose, no code fences.";

function mapTransportError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  const name = (error as { name?: unknown })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new AiError("timeout", "AI request timed out", error);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AiError("request-failed", message, error);
}

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

export function createOpenAiCompatibleClient(
  config: AiTransportConfig,
): AiClient {
  const completionsUrl = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function requestOnce(
    messages: readonly AiChatMessage[],
    options?: AiRequestOptions,
  ): Promise<string> {
    if (!config.apiKey || !config.model) {
      throw new AiError(
        "unconfigured",
        "AI is not configured: set TOBY_AI_API_KEY and TOBY_AI_MODEL",
      );
    }
    const body: ChatCompletionBody = {
      model: config.model,
      messages: [...messages],
      temperature: options?.temperature ?? 0,
      stream: false,
      ...(options?.maxTokens !== undefined
        ? { max_tokens: options.maxTokens }
        : {}),
    };
    let response: Response;
    try {
      response = await fetch(completionsUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw mapTransportError(error);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AiError(
        "request-failed",
        `AI provider responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    const parsed = (await response.json().catch(() => {
      throw new AiError("request-failed", "AI provider returned no JSON body");
    })) as ChatCompletionResponse;
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new AiError(
        "request-failed",
        "AI provider returned no message content",
      );
    }
    return content;
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
