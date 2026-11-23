/**
 * pi-ai message shapes, mirrored verbatim: field names, casing, and
 * nesting exactly as @earendil-works/pi-ai produces them, because
 * transcript-carrying wire surfaces (chat message items, trace runs)
 * replay these values with zero translation (docs/features/chat.md —
 * "message items reuse pi-ai's field names verbatim").
 *
 * Hand-maintained against pi-ai 1.5.2; verify against
 * node_modules/@earendil-works/pi-ai/dist/types.d.ts whenever the catalog
 * in pnpm-workspace.yaml bumps it. The mirror covers the stable,
 * consumer-relevant fields; the wire may carry additional
 * provider-specific fields (signatures, diagnostics) which this package
 * deliberately leaves untyped — clients ignore unknowns.
 *
 * This file stays dependency-free (no pi-ai import): it is the shared
 * vocabulary of both webs and the server, which is why it lives here and
 * not in the runtime.
 */

export interface PiTextContent {
  readonly type: "text";
  readonly text: string;
  readonly textSignature?: string;
}

export interface PiThinkingContent {
  readonly type: "thinking";
  readonly thinking: string;
  readonly thinkingSignature?: string;
  /** True when safety filters redacted the thinking; the opaque payload rides in `thinkingSignature`. */
  readonly redacted?: boolean;
}

export interface PiImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/** Results pair back to their call by `id`. */
export interface PiToolCall {
  readonly type: "toolCall";
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly namespace?: string;
  /** Set when the model's arguments text was not valid JSON (`arguments` is then `{}`). */
  readonly argumentsError?: string;
}

/**
 * Token and cost accounting of one response, as pi-ai reports it. Cost is a
 * catalog estimate unless `cost.totalFromProvider` says the provider billed.
 */
export interface PiUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Subset of `cacheWrite` written with 1h retention; only Anthropic reports the split. */
  readonly cacheWrite1h?: number;
  /** Reasoning/thinking tokens, a subset of `output`; absent when the provider reports no breakdown. */
  readonly reasoning?: number;
  readonly totalTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
    /** True when `total` is the provider's billed cost rather than a catalog estimate. */
    readonly totalFromProvider?: boolean;
  };
}

export type PiStopReason =
  "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** A tool declaration as it was sent to the model (system messages carry them). */
export interface PiToolDeclaration {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema document the model arguments are validated against. */
  readonly parameters: unknown;
}

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

/** One nested tool call a tool made while running (e.g. from a codemode script); results are not recorded. */
export interface PiNestedToolCallRecord {
  readonly id: string;
  readonly name: string;
  /** Omitted when over the size limit; `argumentsBytes` then carries the size. */
  readonly arguments?: Readonly<Record<string, unknown>>;
  /** UTF-8 size of the arguments JSON, set when `arguments` is omitted. */
  readonly argumentsBytes?: number;
  /** `unfinished`: the call was still running when the calling tool finished. */
  readonly status: "ok" | "error" | "unfinished";
  readonly durationMs?: number;
  /** Error text, truncated. */
  readonly error?: string;
}

/** Bounded record of the nested calls one tool made. */
export interface PiNestedToolCalls {
  readonly calls: readonly PiNestedToolCallRecord[];
  /** False when calls were dropped, arguments omitted, or calls had not finished. */
  readonly complete: boolean;
}

export interface PiToolResultMessage {
  readonly role: "toolResult";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: readonly (PiTextContent | PiImageContent)[];
  /** Tool-specific extra payload (JSON), opaque to the transcript renderer. */
  readonly details?: unknown;
  /** Usage of the tool execution itself; not part of the main context accounting. */
  readonly usage?: PiUsage;
  /** Kept for the session record; not sent back to the model. */
  readonly nestedCalls?: PiNestedToolCalls;
  readonly isError: boolean;
  readonly timestamp: number;
  readonly durationMs?: number;
}

/** The transcript roles the chat item stream carries (system stays server-side). */
export type PiTranscriptMessage =
  PiUserMessage | PiAssistantMessage | PiToolResultMessage;
