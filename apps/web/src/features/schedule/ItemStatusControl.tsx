import { useRef, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ScheduleEntryView, ScheduleItemRow } from "@toby/contract";
import { scheduleClient } from "@/lib/api.ts";
import { Button } from "@/components/ui/button.tsx";
import { describeError, SELECT_CLASS, statusClass } from "./schedule-view.ts";

export function ItemStatusControl({
  item,
  date,
  entry,
  onNotice,
}: {
  item: ScheduleItemRow;
  date: string;
  entry?: ScheduleEntryView;
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const locked = useRef(false);
  const mutationKey = ["schedule", "write", date, item.id];
  const busy = useIsMutating({ mutationKey }) > 0;
  const [error, setError] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const mutation = useMutation({
    mutationKey,
    mutationFn: async (status: string | null) => {
      await client.cancelQueries({ queryKey: ["schedule", "entries"] });
      if (status === null)
        return entry ? scheduleClient.deleteEntry(entry.id) : null;
      return scheduleClient.putEntry({ itemId: item.id, date, status });
    },
    retry: false,
  });
  async function write(status: string | null) {
    if (
      locked.current ||
      client.isMutating({ mutationKey }) > 0 ||
      status === entry?.status
    )
      return;
    locked.current = true;
    setError(null);
    try {
      const result = await mutation.mutateAsync(status);
      await client.cancelQueries({ queryKey: ["schedule", "entries"] });
      client.setQueriesData<{
        from: string;
        to: string;
        entries: ScheduleEntryView[];
      }>({ queryKey: ["schedule", "entries"] }, (old) => {
        if (!old || date < old.from || date > old.to) return old;
        const entries = old.entries.filter(
          (row) => row.itemId !== item.id || row.date !== date,
        );
        if (result && "itemId" in result) entries.push(result);
        return { ...old, entries };
      });
      onNotice(
        status === null
          ? "已清除记录。"
          : "已记录；如果当前筛选不再匹配，该记录将不显示在概览中。",
      );
      const refreshed = await Promise.all([
        client.refetchQueries(
          { queryKey: ["schedule", "entries"], type: "active" },
          { throwOnError: true },
        ),
        client.refetchQueries(
          { queryKey: ["schedule", "items"], type: "active" },
          { throwOnError: true },
        ),
      ]).then(
        () => true,
        () => false,
      );
      if (!refreshed)
        onNotice("已保存，列表更新失败。请重试读取，无需重复提交。");
    } catch (failure) {
      setError(describeError(failure));
      void client.invalidateQueries({ queryKey: ["schedule"] });
    } finally {
      locked.current = false;
    }
  }
  return (
    <div className="min-w-0 space-y-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="break-words text-sm font-medium">{item.title}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${entry ? statusClass(item, entry.status) : "text-muted-foreground"}`}
        >
          {entry ? `● ${entry.status}` : "○ 未记录"}
        </span>
      </div>
      <div
        role="group"
        aria-label={`${date} ${item.title}的状态`}
        className="flex flex-wrap gap-1.5"
      >
        {item.statuses.length <= 3 &&
        item.statuses.every((status) => status.length <= 6) ? (
          item.statuses.map((status, index) => (
            <Button
              key={status}
              ref={(node) => {
                if (node) buttons.current.set(status, node);
                else buttons.current.delete(status);
              }}
              size="sm"
              variant={entry?.status === status ? "secondary" : "outline"}
              aria-pressed={entry?.status === status}
              disabled={busy}
              className={
                entry?.status === status ? statusClass(item, status) : ""
              }
              onClick={() => void write(status)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const delta =
                  event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                const next =
                  item.statuses[
                    (index + delta + item.statuses.length) %
                      item.statuses.length
                  ];
                if (next) buttons.current.get(next)?.focus();
              }}
            >
              {entry?.status === status && "✓ "}
              {status}
            </Button>
          ))
        ) : (
          <select
            aria-label={`设置${item.title}的状态`}
            className={`${SELECT_CLASS} max-w-full`}
            value={entry?.status ?? ""}
            disabled={busy}
            onChange={(event) => void write(event.target.value)}
          >
            <option value="" disabled>
              选择状态…
            </option>
            {item.statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        )}
        {entry && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void write(null)}
            aria-label={`清除${date} ${item.title}的记录`}
          >
            清除记录
          </Button>
        )}
      </div>
      {busy && (
        <p className="text-xs text-muted-foreground" role="status">
          记录中…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error} 请重试；若状态已变更，请先刷新。
        </p>
      )}
    </div>
  );
}
