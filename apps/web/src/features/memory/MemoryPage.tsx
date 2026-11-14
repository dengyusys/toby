/**
 * Memory route ("/memory"): MEMORY.md shown raw — the file's Markdown
 * source in a monospace block, in file order, with no rendering and no
 * editing. All changes happen through chat sentences or hand-editing the
 * file. The header keeps exactly two controls: the off-record toggle and
 * a two-step destructive reset that clears every entry.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { memoryClient } from "@/lib/api.ts";
import { describeError, isMemoryFileInvalid } from "./memory-view.ts";

/** Entries to clear: the file's own "- " lines, counted client-side. */
function countEntries(markdown: string): number {
  return markdown.split("\n").filter((line) => line.startsWith("- ")).length;
}

export function MemoryPage() {
  const queryClient = useQueryClient();
  // The raw view and the toggle share the "memory" key prefix so one
  // reset invalidation refetches both.
  const rawQuery = useQuery({
    queryKey: ["memory", "file"],
    queryFn: () => memoryClient.readFile(),
  });
  const offRecordQuery = useQuery({
    queryKey: ["memory", "off-record"],
    queryFn: () => memoryClient.getOffRecord(),
  });

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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
      setResetError(null);
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
    onError: (error) => setResetError(describeError(error)),
  });

  const offRecord = offRecordQuery.data?.on;
  const markdown = rawQuery.data ?? "";
  const entryCount = countEntries(markdown);

  function openResetConfirm() {
    setResetError(null);
    setConfirmingReset(true);
  }

  function cancelReset() {
    setConfirmingReset(false);
    setResetError(null);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-12 max-[767px]:pr-0">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              记忆
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管家记忆文件的原文。想改记忆，在聊天里说一声，或直接手工编辑
              MEMORY.md。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rawQuery.isPending || resetMutation.isPending}
              onClick={openResetConfirm}
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
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 shadow-sm"
          >
            <h2 className="font-serif text-lg font-semibold text-destructive">
              重置记忆？
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {rawQuery.isError
                ? "无法读取文件（可能已损坏）。此操作不可撤销。"
                : `将清空 ${entryCount} 条记忆（MEMORY.md 里所有「- 」开头的行）。此操作不可撤销。`}
            </p>
            {resetError && (
              <p
                role="alert"
                className="mt-2 text-xs leading-5 text-destructive"
              >
                重置失败：{resetError}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resetMutation.isPending}
                onClick={cancelReset}
                className="text-muted-foreground"
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
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
            正在读取 MEMORY.md…
          </div>
        ) : rawQuery.error ? (
          <section className="rounded-xl border border-destructive/30 bg-card p-6 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">
              {isMemoryFileInvalid(rawQuery.error)
                ? "记忆文件需要修复"
                : "无法读取记忆文件"}
            </h2>
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
        ) : markdown.trim() === "" ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            还没有任何记忆——聊天里说“记住…”，管家就会记下来。
          </div>
        ) : (
          <section
            aria-label="记忆原文"
            className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm"
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
              {markdown}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
