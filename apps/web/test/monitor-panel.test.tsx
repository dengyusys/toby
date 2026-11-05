/**
 * The monitor panel against a scripted EventSource: runs stream in from
 * /api/traces/stream, the list and detail render them, 返回列表 swaps back,
 * and 清空 drops the local history (the server keeps none). The stream
 * lives in the provider — the same instance the gated routes share, so
 * closing the drawer never stops collection.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MonitorPanel } from "../src/features/traces/MonitorPanel.tsx";
import { TraceStreamProvider } from "../src/features/traces/trace-stream.tsx";

type TraceListener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, TraceListener>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: TraceListener): void {
    this.listeners.set(name, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(payload: unknown): void {
    this.listeners.get("trace")?.({ data: JSON.stringify(payload) });
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

function renderPanel(): FakeEventSource {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(
    <TraceStreamProvider>
      <MonitorPanel onClose={() => {}} />
    </TraceStreamProvider>,
  );
  return FakeEventSource.instances[0]!;
}

const STARTED = {
  type: "run-started",
  run: {
    id: "r1",
    kind: "agent",
    label: "ledger-extraction",
    model: "faux/faux-1",
    prompt: "午饭 25",
    started_at: "2026-11-03T12:00:00.000Z",
  },
} as const;

const FINISHED = {
  type: "run-finished",
  run: {
    id: "r1",
    kind: "agent",
    label: "ledger-extraction",
    model: "faux/faux-1",
    prompt: "午饭 25",
    started_at: "2026-11-03T12:00:00.000Z",
    duration_ms: 1200,
    status: "succeeded",
    // pi-ai verbatim transcript: field names and content blocks exactly as
    // the runtime produced them.
    messages: [
      { role: "system", content: "你是记账助手", timestamp: 1 },
      { role: "user", content: "午饭 25", timestamp: 2 },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "submit_entries", arguments: {} },
        ],
        model: "faux-1",
        usage: {
          input: 100,
          output: 50,
          totalTokens: 150,
          cost: { input: 0.00008, output: 0.000043, total: 0.000123 },
        },
        stopReason: "toolUse",
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "submit_entries",
        content: [{ type: "text", text: "已提交 1 条,立即记入账本。" }],
        isError: false,
        timestamp: 4,
      },
    ],
    result_text: "已记录 1 条草稿",
    turns: 1,
    usage: {
      input: 100,
      output: 50,
      totalTokens: 150,
      cost: { input: 0.00008, output: 0.000043, total: 0.000123 },
    },
  },
} as const;

it("subscribes to the trace stream on mount", () => {
  const source = renderPanel();
  expect(source.url).toBe("/api/traces/stream");
});

it("shows the running entry as the run starts", async () => {
  const source = renderPanel();
  source.emit(STARTED);
  expect(await screen.findByText("运行中")).toBeInTheDocument();
  // The kind badge sits on the list row.
  expect(screen.getByText("工具循环")).toBeInTheDocument();
});

it("opens a run's transcript from the list, then returns", async () => {
  const source = renderPanel();
  source.emit(STARTED);
  source.emit(FINISHED);
  const row = await screen.findByRole("button", {
    name: /ledger-extraction/,
  });
  fireEvent.click(row);
  expect((await screen.findAllByText("成功")).length).toBeGreaterThan(0);
  // The detail view: verbatim transcript messages and the final reply.
  expect(screen.getByText("你是记账助手")).toBeInTheDocument();
  expect(screen.getByText("调用工具:submit_entries")).toBeInTheDocument();
  expect(screen.getByText("已记录 1 条草稿")).toBeInTheDocument();
  // The tool result pairs back by toolCallId and renders its content.
  expect(screen.getByText("工具结果:submit_entries")).toBeInTheDocument();
  expect(screen.getByText("已提交 1 条,立即记入账本。")).toBeInTheDocument();
  // The duration shows in both the list row and the detail header.
  expect((await screen.findAllByText("1.2s")).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "← 返回列表" }));
  expect(screen.getByRole("button", { name: /ledger-extraction/ }));
  expect(screen.queryByText("你是记账助手")).not.toBeInTheDocument();
});

it("clears the local history", async () => {
  const source = renderPanel();
  source.emit(STARTED);
  expect(await screen.findByText("运行中")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  expect(screen.getByText(/去对话页说一句话试试/)).toBeInTheDocument();
});

it("closes the stream when the provider unmounts", () => {
  const source = renderPanel();
  cleanup();
  expect(source.closed).toBe(true);
});

it("the provider owns the stream: unmounting the panel keeps it open", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  // Closing the drawer swaps the panel out; the EventSource must survive
  // it — runs keep flowing while the user chats with the drawer shut.
  const { rerender } = render(
    <TraceStreamProvider>
      <MonitorPanel onClose={() => {}} />
    </TraceStreamProvider>,
  );
  const source = FakeEventSource.instances[0]!;
  expect(source.closed).toBe(false);
  rerender(<TraceStreamProvider>{null}</TraceStreamProvider>);
  expect(source.closed).toBe(false);
});
