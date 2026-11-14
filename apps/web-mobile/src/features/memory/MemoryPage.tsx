/**
 * Memory route ("/memory", mobile): a read-only raw view of MEMORY.md —
 * the Markdown source itself in a monospace block; no rendering, no
 * per-line buttons, no editors. Entries change through chat or by hand
 * editing the file. The header keeps the off-record toggle and a
 * two-step destructive reset. This mobile copy owns its layout; nothing
 * is imported from PC.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { memoryClient } from "@/lib/api.ts";
import { describeError } from "./memory-view.ts";

/** An entry line is exactly a raw line that starts with "- ". */
function countEntryLines(raw: string): number {
  return raw.split("\n").filter((line) => line.startsWith("- ")).length;
}

export function MemoryPage() {
  const queryClient = useQueryClient();
  const rawQuery = useQuery({
    queryKey: ["memory", "raw"],
    queryFn: () => memoryClient.readFile(),
  });
  const offRecordQuery = useQuery({
    queryKey: ["memory", "off-record"],
    queryFn: () => memoryClient.getOffRecord(),
  });

  const [confirmingReset, setConfirmingReset] = useState(false);

  const offRecordMutation = useMutation({
    mutationFn: (on: boolean) => memoryClient.setOffRecord(on),
    onSuccess: (state) => {
      queryClient.setQueryData(["memory", "off-record"], state);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => memoryClient.reset(),
    onSuccess: () => {
      setConfirmingReset(false);
      // Active queries under ["memory"] refetch: the cleared file shows
      // immediately.
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });

  function closeResetPanel() {
    setConfirmingReset(false);
    resetMutation.reset();
  }

  const offRecord = offRecordQuery.data?.on;
  const raw = rawQuery.data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              记忆
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管家的备忘录，记下约定、你和重要的人。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resetMutation.isPending}
              onClick={() => {
                resetMutation.reset();
                setConfirmingReset(true);
              }}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <RotateCcw className="size-3.5" />
              重置
            </Button>
            <button
              type="button"
              aria-pressed={offRecord === true}
              title="关闭后需手动重新开启；重启服务也会恢复记忆"
              disabled={offRecord === undefined || offRecordMutation.isPending}
              onClick={() => {
                if (offRecord !== undefined)
                  offRecordMutation.mutate(!offRecord);
              }}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                offRecord === true
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground hover:bg-accent-soft hover:text-foreground"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${offRecord === true ? "bg-destructive" : "bg-faint"}`}
              />
              {offRecord === true ? "开启记忆" : "关闭记忆"}
              {(offRecordMutation.isPending || offRecord === undefined) && (
                <span className="text-[11px] opacity-75">
                  {offRecordMutation.isPending
                    ? "设置中…"
                    : offRecordQuery.isError
                      ? "未读取"
                      : "读取中…"}
                </span>
              )}
            </button>
          </div>
        </header>

        {(offRecordMutation.error || offRecordQuery.error) && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            无法读取或更改不记忆设置：
            {describeError(offRecordMutation.error ?? offRecordQuery.error)}
          </p>
        )}

        {confirmingReset && (
          <section
            aria-label="确认重置记忆"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3.5"
          >
            <h2 className="font-serif text-base font-semibold text-destructive">
              重置记忆？
            </h2>
            {resetMutation.error && (
              <p
                role="alert"
                className="mt-2 text-xs leading-5 text-destructive"
              >
                重置失败：{describeError(resetMutation.error)}
              </p>
            )}
            <p className="mt-1.5 text-sm leading-6 text-foreground">
              {rawQuery.isPending
                ? "正在读取文件…"
                : rawQuery.isError
                  ? "无法读取文件（可能已损坏）"
                  : `将清空全部 ${countEntryLines(raw ?? "")} 条记忆，文件回到空白。`}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              此操作不可撤销。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={resetMutation.isPending}
                onClick={closeResetPanel}
                className="text-muted-foreground"
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
              >
                {resetMutation.isPending ? "重置中…" : "确认重置"}
              </Button>
            </div>
          </section>
        )}

        {rawQuery.isPending ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            正在读取备忘录…
          </div>
        ) : rawQuery.error ? (
          <section className="rounded-xl border border-destructive/30 bg-card p-6 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">无法读取记忆</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {describeError(rawQuery.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={rawQuery.isFetching}
              onClick={() => void rawQuery.refetch()}
            >
              {rawQuery.isFetching ? "读取中…" : "重新读取"}
            </Button>
          </section>
        ) : rawQuery.data.trim() === "" ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm leading-6 text-muted-foreground">
            还没有任何记忆——聊天里说“记住…”，管家就会记下来。
          </div>
        ) : (
          <section
            aria-label="记忆原文"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            {/* Raw Markdown source: monospace, preserved line breaks;
                long lines wrap instead of scrolling off a narrow screen. */}
            <pre className="overflow-hidden px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">
              {rawQuery.data}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
