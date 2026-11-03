/**
 * The trace event contract (docs/features/traces.md): every AI call reports
 * one run-started event when it begins and one run-finished event when it
 * settles. Nothing is stored — the bus fans events out to live subscribers
 * (the /api/traces/stream SSE endpoint) and forgets them, and the monitor
 * page keeps its own console-style history. Wire shapes are snake_case and
 * mirrored by hand in packages/contract/src/trace-events.ts.
 */

/** Which AI path produced the run. */
export type TraceRunKind = "agent" | "single-shot";

export interface TraceUsage {
  readonly input: number;
  readonly output: number;
  readonly total_tokens: number;
  /** Best available total cost (provider-billed when reported, else catalog estimate). */
  readonly cost_total: number;
}

/** A tool declaration as it was sent to the model (system messages carry them). */
export interface TraceToolDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: unknown;
}

export interface TraceToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw arguments as JSON text ("" when the model sent none). */
  readonly arguments: string;
}

/**
 * A transcript message, normalized away from pi-ai's shapes so the wire and
 * the web viewer stay stable. Unknown messages survive as {role:"unknown"}.
 */
export type TraceMessage =
  | {
      readonly role: "system";
      readonly text: string;
      readonly tools?: readonly TraceToolDeclaration[];
    }
  | { readonly role: "user"; readonly text: string }
  | {
      readonly role: "assistant";
      readonly text: string;
      readonly thinking?: string;
      readonly tool_calls: readonly TraceToolCall[];
      readonly stop_reason?: string;
      readonly duration_ms?: number;
      readonly usage?: TraceUsage;
    }
  | {
      readonly role: "tool_result";
      readonly tool_call_id: string;
      readonly tool_name?: string;
      /** Result content flattened to text ("[unrenderable]" when not textual). */
      readonly content: string;
      readonly is_error?: boolean;
    }
  | { readonly role: "unknown"; readonly raw: unknown };

/** Self-contained: a subscriber that missed run-started can still render it. */
export interface TraceRunStarted {
  readonly id: string;
  readonly kind: TraceRunKind;
  readonly label: string;
  readonly model: string;
  readonly prompt: string;
  readonly started_at: string;
}

export interface TraceRunFinished {
  readonly id: string;
  readonly kind: TraceRunKind;
  readonly label: string;
  readonly model: string;
  readonly prompt: string;
  readonly started_at: string;
  readonly duration_ms: number;
  readonly status: "succeeded" | "failed";
  readonly messages: readonly TraceMessage[];
  readonly result_text?: string;
  readonly error?: string;
  readonly stop_reason?: string;
  readonly turns?: number;
  readonly usage?: TraceUsage;
}

export type TraceEvent =
  | { readonly type: "run-started"; readonly run: TraceRunStarted }
  | { readonly type: "run-finished"; readonly run: TraceRunFinished };

/** What a model-layer caller uses to report one run. */
export interface TraceReporter {
  begin(input: TraceBeginInput): TraceRunCapture;
}

export interface TraceBeginInput {
  readonly kind: TraceRunKind;
  readonly label: string;
  readonly model: string;
  readonly prompt: string;
}

/** One run's handle; finish() closes the record exactly once. */
export interface TraceRunCapture {
  finish(outcome: TraceFinishOutcome): void;
}

export interface TraceFinishOutcome {
  readonly status: "succeeded" | "failed";
  readonly messages: readonly TraceMessage[];
  readonly result_text?: string;
  readonly error?: string;
  readonly stop_reason?: string;
  readonly turns?: number;
  readonly usage?: TraceUsage;
}

/** The fan-out side the traces domain subscribes to. */
export interface TraceBus extends TraceReporter {
  /** Returns the unsubscribe function. */
  subscribe(listener: (event: TraceEvent) => void): () => void;
}
