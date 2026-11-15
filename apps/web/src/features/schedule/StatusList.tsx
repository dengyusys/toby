import type {
  ScheduleEntryView,
  ScheduleItemRow,
  ScheduleViewConfig,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { ItemStatusControl } from "./ItemStatusControl.tsx";

export function StatusList({
  entries,
  items,
  config,
  ready,
  onSelect,
  onNotice,
}: {
  entries: ScheduleEntryView[];
  items: ScheduleItemRow[];
  config: ScheduleViewConfig;
  ready: boolean;
  onSelect: (date: string) => void;
  onNotice: (text: string) => void;
}) {
  const groups = new Map<string, ScheduleEntryView[]>();
  for (const row of entries) {
    const key =
      config.group === "item"
        ? row.title
        : config.group === "status"
          ? row.status
          : config.sort === "date"
            ? row.date
            : "全部记录";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const sections = [...groups];
  if (config.group !== "none")
    sections.sort(([a], [b]) => a.localeCompare(b, "zh-CN"));
  return (
    <div className="space-y-4">
      {sections.map(([name, rows]) => (
        <section key={name} className="rounded-lg border bg-card px-4">
          <h2 className="border-b py-3 font-medium">{name}</h2>
          {rows.map((row) => {
            const item = items.find((item) => item.id === row.itemId);
            return (
              <div key={row.id} className="border-b py-2 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.date}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelect(row.date)}
                  >
                    填写这一天
                  </Button>
                </div>
                {ready && item ? (
                  <ItemStatusControl
                    item={item}
                    date={row.date}
                    entry={row}
                    onNotice={onNotice}
                  />
                ) : (
                  <p className="py-3 text-sm">
                    {row.title} · {row.status}（只读）
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
