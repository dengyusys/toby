/**
 * The in-memory trace bus: fan-out only, no storage. A listener attached
 * before a run sees run-started and run-finished; a listener that joins
 * late sees nothing from before — run-finished is self-contained so a
 * missed run-started never renders half a record. Console semantics: the
 * observer keeps the history, the server keeps none.
 */

import type { Clock } from "../clock.ts";
import type {
  TraceBeginInput,
  TraceBus,
  TraceEvent,
  TraceRunCapture,
  TraceRunStarted,
} from "./types.ts";

export function createTraceBus(deps: { clock?: Clock } = {}): TraceBus {
  const clock = deps.clock ?? Date.now;
  const listeners = new Set<(event: TraceEvent) => void>();

  const emit = (event: TraceEvent): void => {
    // Copy: a listener that unsubscribes mid-delivery must not mutate the
    // iteration, and a throwing listener must not break the others.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A broken observer never takes the AI call down with it.
      }
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    begin(input: TraceBeginInput): TraceRunCapture {
      const startedMs = clock();
      const started: TraceRunStarted = {
        id: crypto.randomUUID(),
        ...input,
        started_at: new Date(startedMs).toISOString(),
      };
      emit({ type: "run-started", run: started });

      let closed = false;
      return {
        finish(outcome) {
          if (closed) {
            return;
          }
          closed = true;
          emit({
            type: "run-finished",
            run: {
              ...started,
              duration_ms: Math.max(0, clock() - startedMs),
              ...outcome,
            },
          });
        },
      };
    },
  };
}
