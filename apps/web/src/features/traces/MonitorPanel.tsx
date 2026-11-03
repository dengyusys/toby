/**
 * The AI trace monitor panel: a console view over the session-level trace
 * stream (trace-stream.tsx), rendered as the layout's right drawer. The
 * list shows runs as they happen (newest first); picking one swaps to its
 * full record — prompt, transcript, outcome — with a way back. History
 * accrues in the provider across drawer toggles; a reload starts a blank
 * console, like a browser console.
 */

import { useState } from "react";
import { StatusDot, type StatusDotState } from "@/components/StatusDot.tsx";
import { formatDuration } from "./format.ts";
import { RunDetail } from "./RunDetail.tsx";
import { type TraceRun, useTraceStream } from "./trace-stream.tsx";

const KIND_TEXT = { agent: "工具循环", "single-shot": "单发" } as const;

export function MonitorPanel({ onClose }: { onClose: () => void }) {
  const { runs, connected, clear } = useTraceStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <StatusDot state={connected ? "ok" : "error"} />
        <h2 className="text-sm font-medium">AI 调用轨迹</h2>
        <span className="text-xs text-muted-foreground">
          {connected ? "实时" : "未连接"}
        </span>
        <button
          type="button"
          onClick={clear}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          清空
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭监控"
          title="关闭监控"
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CloseIcon className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <RunDetail run={selected} onBack={() => setSelectedId(null)} />
        ) : runs.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            还没有 AI 调用记录。
            <br />
            登录后的每次 AI 调用都会出现在这里——去对话页说一句话试试。
          </p>
        ) : (
          runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onSelect={() => setSelectedId(run.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RunRow({ run, onSelect }: { run: TraceRun; onSelect: () => void }) {
  const dot: StatusDotState =
    run.phase === "running"
      ? "pending"
      : run.status === "succeeded"
        ? "ok"
        : "error";
  const statusText =
    run.phase === "running"
      ? "运行中"
      : run.status === "succeeded"
        ? "成功"
        : "失败";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {new Date(run.started_at).toLocaleTimeString("zh-CN", {
            hour12: false,
          })}
        </span>
        <StatusDot state={dot} />
        <span>{statusText}</span>
        {run.phase === "finished" && (
          <span className="ml-auto tabular-nums">
            {formatDuration(run.duration_ms)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="truncate text-sm font-medium">{run.label}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {KIND_TEXT[run.kind]}
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {run.prompt || "(无文本输入)"}
      </p>
    </button>
  );
}

/** Thin outline cross (the drawer's close affordance). */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
