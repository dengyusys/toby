import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { ScheduleEntryView, ScheduleItemRow } from "@toby/contract";
import { monthRange, statusClass, todayDate } from "./schedule-view.ts";

export function MonthStatusBoard({
  month,
  date,
  entries,
  allEntries,
  items,
  onSelect,
}: {
  month: string;
  date: string;
  entries: ScheduleEntryView[];
  allEntries: ScheduleEntryView[];
  items: ScheduleItemRow[];
  onSelect: (date: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [year, number] = month.split("-").map(Number);
  const first = new Date(year!, number! - 1, 1).getDay();
  const days = Number(monthRange(month).to.slice(-2));
  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: number) {
    const shifts: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    let target: number;
    if (event.key === "Home") target = 1;
    else if (event.key === "End") target = days;
    else if (event.key in shifts)
      target = Math.max(1, Math.min(days, day + shifts[event.key]!));
    else if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("schedule-day-panel")?.focus();
      return;
    } else return;
    event.preventDefault();
    const value = `${month}-${String(target).padStart(2, "0")}`;
    onSelect(value);
    refs.current.get(value)?.focus();
  }
  return (
    <section
      aria-label="每日状态月历"
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
    >
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs text-muted-foreground">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
          <span key={day} className="py-2.5">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {Array.from(
          { length: Math.ceil((first + days) / 7) * 7 },
          (_, index) => {
            const day = index - first + 1;
            if (day < 1 || day > days)
              return (
                <div
                  key={index}
                  aria-hidden="true"
                  className="min-h-28 bg-muted"
                />
              );
            const value = `${month}-${String(day).padStart(2, "0")}`;
            const rows = entries
              .filter((row) => row.date === value)
              .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
            return (
              <button
                type="button"
                key={value}
                ref={(node) => {
                  if (node) refs.current.set(value, node);
                  else refs.current.delete(value);
                }}
                tabIndex={date === value ? 0 : -1}
                aria-pressed={date === value}
                aria-label={`${value}，${rows.length ? rows.map((row) => `${row.title}：${row.status}`).join("，") : allEntries.some((row) => row.date === value) ? "无匹配记录" : "未记录"}`}
                onKeyDown={(event) => navigate(event, day)}
                onClick={() => onSelect(value)}
                className={`flex min-h-28 min-w-0 flex-col gap-1 p-1.5 text-left transition-colors hover:bg-accent-soft focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring ${date === value ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--primary)]" : "bg-card"}`}
              >
                <span
                  className={`mb-1 self-end rounded-full px-1.5 font-mono text-xs ${value === todayDate() ? "bg-primary font-bold text-primary-foreground" : "text-muted-foreground"}`}
                >
                  {day}
                </span>
                {rows.slice(0, 3).map((row) => (
                  <span
                    key={row.id}
                    className={`block max-w-full truncate rounded px-1 text-[11px] leading-5 ${statusClass(
                      items.find((item) => item.id === row.itemId),
                      row.status,
                    )}`}
                  >
                    ● {row.title} {row.status}
                  </span>
                ))}
                {rows.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    另{rows.length - 3}项已记录
                  </span>
                )}
                {!rows.length && (
                  <span className="text-[10px] text-muted-foreground">
                    {allEntries.some((row) => row.date === value)
                      ? "无匹配记录"
                      : "未记录"}
                  </span>
                )}
              </button>
            );
          },
        )}
      </div>
    </section>
  );
}
