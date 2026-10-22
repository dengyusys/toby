/**
 * The AI ports (docs/decisions/ai-pi-runtime.md): a restricted single-shot
 * completion port plus the runtime configuration shared by both AI paths.
 * All transport lives in pi-ai; this file is the contract and stays free of
 * transport imports.
 */

export type AiRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  readonly role: AiRole;
  readonly content: string;
}

export interface AiRequestOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/**
 * Single-shot completion port for AI paths that need no tool loop (intent
 * classification and the like). Tool-loop paths go through the agent
 * factory in agent.ts instead.
 */
export interface AiClient {
  /**
   * Structured data: instructs JSON output, parses it, retries the whole
   * request once when the reply is not parseable JSON. The result is
   * whatever the model produced — still untrusted until a domain validates
   * it against its own schema.
   */
  json(
    messages: readonly AiChatMessage[],
    options?: AiRequestOptions,
  ): Promise<unknown>;
  /** Prose completion. */
  text(
    messages: readonly AiChatMessage[],
    options?: AiRequestOptions,
  ): Promise<string>;
}

/**
 * AI runtime configuration resolved from TOBY_AI_* environment variables.
 * `model` is pi-ai's "provider/model" pair (e.g. "zai/glm-4.7"); provider
 * credentials live in pi-ai's per-provider environment variables (e.g.
 * ZAI_API_KEY) or its credential store — never in this config.
 */
export interface AiRuntimeConfig {
  readonly model: string;
  readonly timeoutMs: number;
}
