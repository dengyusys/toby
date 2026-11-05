/**
 * The trace event contract (docs/features/traces.md): every AI call reports
 * one run-started event when it begins and one run-finished event when it
 * settles. Nothing is stored — the bus fans events out to live subscribers
 * (the /api/traces/stream SSE endpoint) and forgets them, and the monitor
 * page keeps its own console-style history.
 *
 * Carried values are pi-ai verbatim: `messages`, `usage`, and `stopReason`
 * replay exactly what the runtime produced — same field names, same
 * casing, zero translation (mirrored in packages/contract). Fields that
 * are Toby's own (`started_at`, `duration_ms`, `label`, …) keep the
 * snake_case wire style.
 */

import type { Message, StopReason, Usage } from "@earendil-works/pi-ai";

/** Which AI path produced the run. */
export type TraceRunKind = "agent" | "single-shot";

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
  /** The run's pi-ai transcript verbatim, system prompt included. */
  readonly messages: readonly Message[];
  readonly result_text?: string;
  readonly error?: string;
  readonly stopReason?: StopReason;
  readonly turns?: number;
  readonly usage?: Usage;
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
  readonly messages: readonly Message[];
  readonly result_text?: string;
  readonly error?: string;
  readonly stopReason?: StopReason;
  readonly turns?: number;
  readonly usage?: Usage;
}

/** The fan-out side the traces domain subscribes to. */
export interface TraceBus extends TraceReporter {
  /** Returns the unsubscribe function. */
  subscribe(listener: (event: TraceEvent) => void): () => void;
}
