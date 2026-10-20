/**
 * The AI port (docs/decisions/ai-integration.md): a restricted JSON
 * protocol over one small transport interface. The model returns candidate
 * data only — parsing, validation and execution stay on the server. This
 * file is the contract and stays free of transport imports.
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

/** Transport configuration resolved from TOBY_AI_* environment variables. */
export interface AiTransportConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}
