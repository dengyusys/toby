/**
 * pi-ai message shapes, mirrored verbatim: field names, casing, and
 * nesting exactly as @earendil-works/pi-ai produces them, because
 * transcript-carrying wire surfaces (chat message items, trace runs)
 * replay these values with zero translation (docs/features/chat.md —
 * "message items reuse pi-ai's field names verbatim").
 *
 * Hand-maintained against pi-ai 1.5.0 (dist/types.d.ts). The mirror covers
 * the stable, consumer-relevant fields; the wire may carry additional
 * provider-specific fields (signatures, diagnostics) which this package
 * deliberately leaves untyped — clients ignore unknowns.
 *
 * This file stays dependency-free (no pi-ai import): it is the shared
 * vocabulary of both webs and the server, which is why it lives here and
 * not in the runtime.
 */

/** A text block inside message content. */
export interface PiTextContent {
  readonly type: "text";
  readonly text: string;
  readonly textSignature?: string;
}

/** A thinking block inside assistant content. */
export interface PiThinkingContent {
  readonly type: "thinking";
  readonly thinking: string;
  readonly thinkingSignature?: string;
  /** True when safety filters redacted the thinking. */
  readonly redacted?: boolean;
}

/** An image block (base64 data + mime type). */
export interface PiImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/** A tool call an assistant message issued; results pair back by `id`. */
export interface PiToolCall {
  readonly type: "toolCall";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly namespace?: string;
  /** Set when the model's arguments text was not valid JSON (`arguments` is then `{}`). */
  readonly argumentsError?: string;
}

/** Token/cost accounting of one assistant response. */
export interface PiUsage {
  readonly input: number;
  readonly output: number;
  readonly totalTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
  };
}

export type PiStopReason =
  "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** A tool declaration as it was sent to the model (system messages carry them). */
export interface PiToolDeclaration {
  readonly name: string;
  readonly description?: string;
  /** The JSON Schema document the model arguments are validated against. */
  readonly parameters?: unknown;
}

/** A reference to a tool being removed from the available set. */
export interface PiToolReference {
  readonly name: string;
}

export interface PiSystemMessage {
  readonly role: "system";
  readonly content: string | readonly PiTextContent[];
  /** Named, ordered prompt sections rendered after `content`. */
  readonly sections?: Readonly<Record<string, string | null>>;
  readonly toolsAdded?: readonly PiToolDeclaration[];
  readonly toolsRemoved?: readonly PiToolReference[];
  readonly timestamp: number;
}

export interface PiUserMessage {
  readonly role: "user";
  readonly content: string | readonly (PiTextContent | PiImageContent)[];
  readonly timestamp: number;
}

export interface PiAssistantMessage {
  readonly role: "assistant";
  readonly content: readonly (PiTextContent | PiThinkingContent | PiToolCall)[];
  readonly model: string;
  readonly usage: PiUsage;
  readonly stopReason: PiStopReason;
  readonly errorMessage?: string;
  readonly timestamp: number;
  readonly durationMs?: number;
}

export interface PiToolResultMessage {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: readonly (PiTextContent | PiImageContent)[];
  /** Tool-specific extra payload (JSON), opaque to the transcript renderer. */
  readonly details?: unknown;
  readonly isError: boolean;
  readonly timestamp: number;
  readonly durationMs?: number;
}

/** The transcript roles the chat item stream carries (system stays server-side). */
export type PiTranscriptMessage =
  PiUserMessage | PiAssistantMessage | PiToolResultMessage;
