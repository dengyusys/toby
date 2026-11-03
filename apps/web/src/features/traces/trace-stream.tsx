/**
 * The session-level trace stream: one EventSource on /api/traces/stream,
 * owned by a provider that lives across route switches (mounted with the
 * session-gated routes), so runs keep flowing in while the user chats on
 * another page. Console semantics still hold — the browser accumulates in
 * memory from login on, the server stores nothing, and a reload starts a
 * blank console. EventSource reconnects on its own; anything streamed
 * while no tab had the app open is gone, by design.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  TraceEvent,
  TraceRunFinished,
  TraceRunStarted,
} from "@toby/contract";

/** One run as the page holds it: the started fields, plus the outcome once settled. */
export type TraceRun =
  | ({ phase: "running" } & TraceRunStarted)
  | ({ phase: "finished" } & TraceRunFinished);

/** Browser-side history cap; the oldest entries drop off beyond it. */
const MAX_RUNS = 200;

export interface TraceStream {
  runs: TraceRun[];
  connected: boolean;
  /** Clear the local history (the server keeps nothing to clear). */
  clear: () => void;
}

const TraceStreamContext = createContext<TraceStream | null>(null);

export function TraceStreamProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<TraceRun[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/traces/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("trace", (event) => {
      const payload = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as TraceEvent;
      setRuns((previous) => {
        // Newest first, upsert by id: run-finished replaces its running
        // entry — or stands alone when run-started arrived before mount.
        const rest = previous.filter((run) => run.id !== payload.run.id);
        const next: TraceRun[] =
          payload.type === "run-started"
            ? [{ phase: "running", ...payload.run }, ...rest]
            : [{ phase: "finished", ...payload.run }, ...rest];
        return next.length > MAX_RUNS ? next.slice(0, MAX_RUNS) : next;
      });
    });
    return () => source.close();
  }, []);

  const clear = useCallback(() => setRuns([]), []);

  return (
    <TraceStreamContext.Provider value={{ runs, connected, clear }}>
      {children}
    </TraceStreamContext.Provider>
  );
}

export function useTraceStream(): TraceStream {
  const context = useContext(TraceStreamContext);
  if (!context) {
    throw new Error("useTraceStream requires TraceStreamProvider");
  }
  return context;
}
