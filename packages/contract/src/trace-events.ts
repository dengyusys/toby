/**
 * Trace event mirrors — the SSE frames of GET /api/traces/stream, the web
 * monitor's feed. Hand-mirrored from
 * apps/server/src/infrastructure/trace/types.ts (same convention as the
 * domain clients: server response shapes are duplicated here, not
 * imported). Types only — the EventSource subscription lives in apps/web.
 *
 * Carried values are pi-ai verbatim (messages, usage, stopReason — see
 * pi-messages.ts); Toby's own fields (started_at, duration_ms, …) stay
 * snake_case.
 */

import type {
  PiAssistantMessage,
  PiStopReason,
  PiSystemMessage,
  PiToolResultMessage,
  PiUsage,
  PiUserMessage,
} from "./pi-messages.ts";

/** Which AI path produced the run. */
export type TraceRunKind = "agent" | "single-shot";

/** A transcript message, exactly as pi-ai produced it. */
export type TraceMessage =
  PiSystemMessage | PiUserMessage | PiAssistantMessage | PiToolResultMessage;

/** Self-contained: a subscriber that missed run-started can still render it. */
export interface TraceRunStarted {
  id: string;
  kind: TraceRunKind;
  label: string;
  model: string;
  prompt: string;
  started_at: string;
}

export interface TraceRunFinished {
  id: string;
  kind: TraceRunKind;
  label: string;
  model: string;
  prompt: string;
  started_at: string;
  duration_ms: number;
  status: "succeeded" | "failed";
  /** The run's pi-ai transcript verbatim, system prompt included. */
  messages: TraceMessage[];
  result_text?: string;
  error?: string;
  stopReason?: PiStopReason;
  turns?: number;
  usage?: PiUsage;
}

export type TraceEvent =
  | { type: "run-started"; run: TraceRunStarted }
  | { type: "run-finished"; run: TraceRunFinished };
