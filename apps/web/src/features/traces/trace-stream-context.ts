/**
 * The trace stream's shared context: the TraceRun/TraceStream shapes and the
 * useTraceStream hook live here, apart from the provider component in
 * trace-stream.tsx, so that file exports only a component and stays
 * Fast-Refresh-clean — edits hot-swap without a full page reload.
 */

import { createContext, useContext } from "react";
import type { TraceRunFinished, TraceRunStarted } from "@toby/contract";

/** One run as the page holds it: the started fields, plus the outcome once settled. */
export type TraceRun =
  | ({ phase: "running" } & TraceRunStarted)
  | ({ phase: "finished" } & TraceRunFinished);

export interface TraceStream {
  runs: TraceRun[];
  connected: boolean;
  /** Clear the local history (the server keeps nothing to clear). */
  clear: () => void;
}

export const TraceStreamContext = createContext<TraceStream | null>(null);

export function useTraceStream(): TraceStream {
  const context = useContext(TraceStreamContext);
  if (!context) {
    throw new Error("useTraceStream requires TraceStreamProvider");
  }
  return context;
}
