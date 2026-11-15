import type {
  ScheduleItemRow,
  ScheduleViewConfig,
  ScheduleViewType,
} from "@toby/contract";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SELECT_CLASS } from "./schedule-view.ts";

export function ViewSettingsPanel({
  name,
  type,
  config,
  items,
  busy,
  error,
  selected,
  dirty,
  onName,
  onConfig,
  onSave,
  onDelete,
  onRestore,
}: {
  name: string;
  type: ScheduleViewType;
  config: ScheduleViewConfig;
  items: ScheduleItemRow[];
  busy: boolean;
  error: string | null;
  selected: boolean;
  dirty: boolean;
  onName: (name: string) => void;
  onConfig: (config: ScheduleViewConfig) => void;
  onSave: (asNew: boolean) => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const words = [
    ...new Set([
      ...items.flatMap((item) => item.statuses),
      ...(config.statuses ?? []),
    ]),
  ];
  const toggle = (field: "itemIds" | "statuses", value: string) => {
    const old = config[field] ?? [];
    onConfig({
      ...config,
      [field]: old.includes(value)
        ? old.filter((entry) => entry !== value)
        : [...old, value],
    });
  };
  return (
    <section
      aria-label="视图设置"
      className="space-y-5 rounded-xl border bg-muted/20 p-5"
    >
      <h2 className="font-serif text-lg font-semibold">视图设置</h2>
      <fieldset disabled={busy} className="space-y-5">
        <label className="flex max-w-sm flex-col gap-2 text-sm">
          视图名称
          <Input
            value={name}
            onChange={(event) => onName(event.target.value)}
            placeholder="例如：饮食记录"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            事项 · 包含任一（不选表示全部）
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.itemIds?.includes(String(item.id)) ?? false}
                  onChange={() => toggle("itemIds", String(item.id))}
                />
                {item.title}
              </label>
            ))}
            {config.itemIds
              ?.filter((id) => !items.some((item) => String(item.id) === id))
              .map((id) => (
                <label
                  key={id}
                  className="flex items-center gap-2 text-sm text-destructive"
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggle("itemIds", id)}
                  />
                  已失效事项 #{id}
                </label>
              ))}
            {!items.length && (
              <span className="text-sm text-muted-foreground">
                尚无登记事项
              </span>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            状态 · 包含任一（不选表示全部）
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {words.map((word) => (
              <label key={word} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.statuses?.includes(word) ?? false}
                  onChange={() => toggle("statuses", word)}
                />
                {word}
                <span className="text-xs text-muted-foreground">
                  （
                  {items
                    .filter((item) => item.statuses.includes(word))
                    .map((item) => item.title)
                    .join("、") || "当前词表已无此状态"}
                  ）
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-2 text-sm">
            排序
            <select
              className={SELECT_CLASS}
              value={config.sort}
              onChange={(event) =>
                onConfig({
                  ...config,
                  sort: event.target.value as ScheduleViewConfig["sort"],
                })
              }
            >
              <option value="date">日期升序</option>
              <option value="title">事项名称升序</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            分组
            <select
              className={SELECT_CLASS}
              value={config.group}
              onChange={(event) =>
                onConfig({
                  ...config,
                  group: event.target.value as ScheduleViewConfig["group"],
                })
              }
            >
              <option value="none">不额外分组</option>
              <option value="item">按事项</option>
              <option value="status">按状态</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {type === "calendar"
            ? "月历固定按日期排列，排序与分组仅PC列表生效。"
            : "排序在分组内生效；同值按记录ID排列。"}
          事项和状态条件之间同时满足。
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {selected && (
          <Button disabled={busy || !dirty} onClick={() => onSave(false)}>
            {busy ? "提交中…" : "保存更改"}
          </Button>
        )}
        <Button
          variant={selected ? "outline" : "default"}
          disabled={busy}
          onClick={() => onSave(true)}
        >
          另存为新视图
        </Button>
        <Button variant="ghost" disabled={busy || !dirty} onClick={onRestore}>
          还原
        </Button>
      </div>
      {selected && (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            只删除视图，事项与记录会保留。
          </p>
          <Button
            variant="ghost"
            className="h-auto max-w-full whitespace-normal text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            删除视图『{name}』
          </Button>
        </div>
      )}
    </section>
  );
}
