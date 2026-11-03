/**
 * Trace event mirrors — the SSE frames of GET /api/traces/stream, the web
 * monitor's feed. Hand-mirrored from
 * apps/server/src/infrastructure/trace/types.ts (same convention as the
 * domain clients: server response shapes are duplicated here, not
 * imported). Types only — the EventSource subscription lives in apps/web.
 */

/** Which AI path produced the run. */
export type TraceRunKind = "agent" | "single-shot";

export interface TraceUsage {
  input: number;
  output: number;
  total_tokens: number;
  /** Best available total cost (provider-billed when reported, else catalog estimate). */
  cost_total: number;
}

/** A tool declaration as it was sent to the model. */
export interface TraceToolDeclaration {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface TraceToolCall {
  id: string;
  name: string;
  /** Raw arguments as JSON text ("" when the model sent none). */
  arguments: string;
}

/** A transcript message, normalized away from the provider SDK's shapes. */
export type TraceMessage =
  | { role: "system"; text: string; tools?: TraceToolDeclaration[] }
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      thinking?: string;
      tool_calls: TraceToolCall[];
      stop_reason?: string;
      duration_ms?: number;
      usage?: TraceUsage;
    }
  | {
      role: "tool_result";
      tool_call_id: string;
      tool_name?: string;
      content: string;
      is_error?: boolean;
    }
  | { role: "unknown"; raw: unknown };

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
  messages: TraceMessage[];
  result_text?: string;
  error?: string;
  stop_reason?: string;
  turns?: number;
  usage?: TraceUsage;
}

export type TraceEvent =
  | { type: "run-started"; run: TraceRunStarted }
  | { type: "run-finished"; run: TraceRunFinished };
