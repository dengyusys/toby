/**
 * The session-level trace stream: one EventSource on /api/traces/stream,
 * owned by a provider that lives across route switches (mounted with the
 * session-gated routes), so runs keep flowing in while the user chats on
 * another page. Console semantics still hold — the browser accumulates in
 * memory from login on, the server stores nothing, and a reload starts a
 * blank console. EventSource reconnects on its own; anything streamed
 * while no tab had the app open is gone, by design. The context itself,
 * with the TraceRun shape and the useTraceStream hook, lives in
 * trace-stream-context.ts.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TraceEvent } from "@toby/contract";
import { TraceStreamContext, type TraceRun } from "./trace-stream-context.ts";

/** Browser-side history cap; the oldest entries drop off beyond it. */
const MAX_RUNS = 200;

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
