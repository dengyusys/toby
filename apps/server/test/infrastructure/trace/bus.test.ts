/**
 * The in-memory trace bus: fan-out ordering, self-contained finished
 * events, the once-only finish guard, unsubscribe, and isolation from a
 * throwing listener. Console semantics — nothing is stored, a late
 * subscriber sees nothing from before it attached.
 */

import { describe, expect, it } from "vitest";
import { createTraceBus } from "../../../src/infrastructure/trace/bus.ts";
import type { TraceEvent } from "../../../src/infrastructure/trace/types.ts";

describe("createTraceBus", () => {
  it("emits run-started immediately and a self-contained run-finished", () => {
    let now = 1_000;
    const bus = createTraceBus({ clock: () => now });
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const capture = bus.begin({
      kind: "agent",
      label: "ledger-extraction",
      model: "faux/faux-1",
      prompt: "午饭 25",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "run-started",
      run: {
        id: expect.any(String) as string,
        kind: "agent",
        label: "ledger-extraction",
        model: "faux/faux-1",
        prompt: "午饭 25",
        started_at: new Date(1_000).toISOString(),
      },
    });

    now = 2_500;
    capture.finish({
      status: "succeeded",
      messages: [{ role: "user", content: "午饭 25", timestamp: 1 }],
      result_text: "done",
      turns: 1,
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "run-finished",
      run: {
        id: (events[0] as { run: { id: string } }).run.id,
        kind: "agent",
        label: "ledger-extraction",
        model: "faux/faux-1",
        prompt: "午饭 25",
        started_at: new Date(1_000).toISOString(),
        duration_ms: 1_500,
        status: "succeeded",
        messages: [{ role: "user", content: "午饭 25", timestamp: 1 }],
        result_text: "done",
        turns: 1,
      },
    });
  });

  it("carries the error on a failed outcome", () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));
    bus
      .begin({
        kind: "single-shot",
        label: "complete",
        model: "m",
        prompt: "p",
      })
      .finish({
        status: "failed",
        messages: [],
        error: "provider exploded",
      });
    const finished = events[1] as {
      run: { status: string; error?: string };
    };
    expect(finished.run.status).toBe("failed");
    expect(finished.run.error).toBe("provider exploded");
  });

  it("ignores a second finish — a run closes exactly once", () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const capture = bus.begin({
      kind: "agent",
      label: "a",
      model: "m",
      prompt: "p",
    });
    capture.finish({ status: "succeeded", messages: [] });
    capture.finish({ status: "failed", messages: [], error: "late" });
    expect(events).toHaveLength(2);
    expect((events[1] as { run: { status: string } }).run.status).toBe(
      "succeeded",
    );
  });

  it("keeps no history: a late subscriber sees nothing from before", () => {
    const bus = createTraceBus();
    bus.begin({ kind: "agent", label: "a", model: "m", prompt: "p" }).finish({
      status: "succeeded",
      messages: [],
    });
    const events: TraceEvent[] = [];
    bus.subscribe((event) => events.push(event));
    expect(events).toHaveLength(0);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    bus.begin({ kind: "agent", label: "a", model: "m", prompt: "p" });
    unsubscribe();
    expect(events).toHaveLength(1);
  });

  it("a throwing listener never breaks the others or the run", () => {
    const bus = createTraceBus();
    const events: TraceEvent[] = [];
    bus.subscribe(() => {
      throw new Error("broken observer");
    });
    bus.subscribe((event) => events.push(event));
    bus.begin({ kind: "agent", label: "a", model: "m", prompt: "p" });
    expect(events).toHaveLength(1);
  });
});
