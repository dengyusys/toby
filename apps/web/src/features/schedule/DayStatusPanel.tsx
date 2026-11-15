import type { ScheduleEntryView, ScheduleItemRow } from "@toby/contract";
import { ItemStatusControl } from "./ItemStatusControl.tsx";

export function DayStatusPanel({
  date,
  items,
  entries,
  ready,
  onNotice,
}: {
  date: string;
  items: ScheduleItemRow[];
  entries: ScheduleEntryView[];
  ready: boolean;
  onNotice: (text: string) => void;
}) {
  const rows = entries.filter((row) => row.date === date);
  return (
    <section
      id="schedule-day-panel"
      tabIndex={-1}
      aria-label="当日状态"
      className="min-w-0 rounded-lg border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h2 className="font-mono text-lg font-semibold">{date}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        全部事项 · 已记{rows.length}/{items.length}
        <br />
        视图筛选仅影响月历和列表。
      </p>
      {!ready ? (
        <p className="py-8 text-sm text-muted-foreground">
          当天记录或事项尚未读取，暂时无法设置。
        </p>
      ) : !items.length ? (
        <p className="py-8 text-sm text-muted-foreground">
          先登记一件要记录的事，点击上方“管理事项”。
        </p>
      ) : (
        <div className="mt-3">
          {items.map((item) => (
            <ItemStatusControl
              key={`${date}:${item.id}`}
              item={item}
              date={date}
              entry={rows.find((row) => row.itemId === item.id)}
              onNotice={onNotice}
            />
          ))}
        </div>
      )}
    </section>
  );
}
