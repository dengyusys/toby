import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@toby/contract";
import type { ScheduleEntryView, ScheduleItemRow } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { scheduleClient } from "@/lib/api.ts";
import { describeError, fieldClass, statusClass } from "./schedule-view.ts";

export function ItemStatusControl({
  item,
  date,
  entry,
  onNotice,
}: {
  item: ScheduleItemRow;
  date: string;
  entry?: ScheduleEntryView;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  async function write(status?: string) {
    if (
      locked.current ||
      missing ||
      (status !== undefined && status === entry?.status)
    )
      return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      await queryClient.cancelQueries({ queryKey: ["schedule", "entries"] });
      if (status !== undefined) {
        const result = await scheduleClient.putEntry({
          itemId: item.id,
          date,
          status,
        });
        await queryClient.cancelQueries({ queryKey: ["schedule", "entries"] });
        queryClient.setQueriesData<{
          from: string;
          to: string;
          entries: ScheduleEntryView[];
        }>({ queryKey: ["schedule", "entries"] }, (old) =>
          old && date >= old.from && date <= old.to
            ? {
                ...old,
                entries: [
                  ...old.entries.filter(
                    (row) => !(row.itemId === item.id && row.date === date),
                  ),
                  result,
                ],
              }
            : old,
        );
      } else if (entry) {
        await scheduleClient.deleteEntry(entry.id);
        await queryClient.cancelQueries({ queryKey: ["schedule", "entries"] });
        queryClient.setQueriesData<{
          from: string;
          to: string;
          entries: ScheduleEntryView[];
        }>({ queryKey: ["schedule", "entries"] }, (old) =>
          old
            ? {
                ...old,
                entries: old.entries.filter((row) => row.id !== entry.id),
              }
            : old,
        );
      }
      onNotice(
        status === undefined
          ? `已清除 ${date}「${item.title}」的记录`
          : `已记录 ${date}「${item.title}」：${status}。视图筛选仅影响折叠列表。`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["schedule", "entries"],
      });
      void queryClient.invalidateQueries({ queryKey: ["schedule", "items"] });
    } catch (cause) {
      setError(
        `${status === undefined ? "清除失败" : "记录失败"}：${describeError(cause)}`,
      );
      if (
        cause instanceof ApiError &&
        [
          "SCHEDULE_ITEM_NOT_FOUND",
          "SCHEDULE_INVALID_STATUS",
          "SCHEDULE_ENTRY_NOT_FOUND",
        ].includes(cause.code)
      ) {
        if (cause.code === "SCHEDULE_ITEM_NOT_FOUND") setMissing(true);
        void queryClient.invalidateQueries({ queryKey: ["schedule"] });
      }
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  const short =
    item.statuses.length <= 3 &&
    item.statuses.every((status) => status.length <= 5);
  return (
    <div className="min-w-0 space-y-3 py-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 font-medium break-words">{item.title}</h3>
        <span
          className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm break-words ${entry ? statusClass(item.statuses, entry.status) : "text-muted-foreground"}`}
        >
          <span aria-hidden="true">{entry ? "●" : "○"}</span>
          {entry?.status ?? "未记录"}
        </span>
      </div>
      {short ? (
        <div
          role="group"
          aria-label={`${date} ${item.title}的状态`}
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${item.statuses.length}, minmax(0, 1fr))`,
          }}
        >
          {item.statuses.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={entry?.status === status}
              disabled={pending || missing}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.parentElement!.querySelectorAll("button"),
                );
                const offset =
                  event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                buttons[
                  (buttons.indexOf(event.currentTarget) +
                    offset +
                    buttons.length) %
                    buttons.length
                ]?.focus();
              }}
              onClick={() => void write(status)}
              className={`min-h-11 min-w-0 rounded-md border px-2 py-2 text-sm break-words transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${entry?.status === status ? `${statusClass(item.statuses, status)} border-current font-medium` : "bg-background hover:bg-accent-soft"}`}
            >
              {entry?.status === status && <span aria-hidden="true">✓ </span>}
              {status}
            </button>
          ))}
        </div>
      ) : (
        <select
          aria-label={`${date} ${item.title}的状态`}
          className={fieldClass}
          value={entry?.status ?? ""}
          disabled={pending || missing}
          onChange={(event) => void write(event.target.value)}
        >
          <option value="" disabled>
            选择状态…
          </option>
          {item.statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      )}
      {entry && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 whitespace-normal text-muted-foreground"
          disabled={pending || missing}
          aria-label={`清除 ${date}「${item.title}」的记录`}
          onClick={() => void write()}
        >
          清除记录
        </Button>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          记录中…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} 请重试。
        </p>
      )}
    </div>
  );
}
