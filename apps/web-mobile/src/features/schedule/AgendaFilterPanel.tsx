import type { ScheduleItemRow, ScheduleViewConfig } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";

export function AgendaFilterPanel({
  items,
  config,
  onChange,
  onRestore,
}: {
  items: ScheduleItemRow[];
  config: ScheduleViewConfig;
  onChange: (config: ScheduleViewConfig) => void;
  onRestore: () => void;
}) {
  const words = [...new Set(items.flatMap((item) => item.statuses))];
  function toggle(key: "itemIds" | "statuses", value: string) {
    const values = config[key] ?? [];
    onChange({
      ...config,
      [key]: values.includes(value)
        ? values.filter((word) => word !== value)
        : [...values, value],
    });
  }
  return (
    <section
      aria-label="临时筛选"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <p className="text-sm text-muted-foreground">
        仅筛选折叠的记录；今天和展开日期仍列全部事项。切换视图会放弃临时筛选。
      </p>
      <fieldset>
        <legend className="text-sm font-medium">事项（不选表示全部）</legend>
        {items.map((item) => (
          <label
            key={item.id}
            className="flex min-h-11 items-center gap-3 text-sm break-words"
          >
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={config.itemIds?.includes(String(item.id)) ?? false}
              onChange={() => toggle("itemIds", String(item.id))}
            />
            {item.title}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">状态（不选表示全部）</legend>
        {words.map((word) => (
          <label
            key={word}
            className="flex min-h-11 items-center gap-3 text-sm break-words"
          >
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={config.statuses?.includes(word) ?? false}
              onChange={() => toggle("statuses", word)}
            />
            {word}（
            {items
              .filter((item) => item.statuses.includes(word))
              .map((item) => item.title)
              .join("、")}
            ）
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => onChange({ ...config, itemIds: [], statuses: [] })}
        >
          清除筛选
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={onRestore}
        >
          恢复视图
        </Button>
      </div>
    </section>
  );
}
