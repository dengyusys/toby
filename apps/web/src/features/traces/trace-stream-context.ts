/**
 * The trace stream's shared context. Split from the provider so
 * trace-stream.tsx exports only a component and stays Fast-Refresh-clean.
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
