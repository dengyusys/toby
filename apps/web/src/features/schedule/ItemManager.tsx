import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ScheduleItemRow } from "@toby/contract";
import { scheduleClient } from "@/lib/api.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { describeError } from "./schedule-view.ts";

export function ItemManager({
  items,
  onNotice,
}: {
  items: ScheduleItemRow[];
  onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const deletionLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function remove(item: ScheduleItemRow) {
    if (deletionLock.current) return;
    deletionLock.current = true;
    setDeleting(item.id);
    setError(null);
    try {
      await client.cancelQueries({ queryKey: ["schedule"] });
      const result = await scheduleClient.deleteItem(item.id);
      client.setQueryData<ScheduleItemRow[]>(["schedule", "items"], (old) =>
        old?.filter((row) => row.id !== item.id),
      );
      if (editing === item.id) setEditing(null);
      onNotice(
        `已删除『${item.title}』及其 ${result.deletedEntries} 条记录，视图筛选已更新。`,
      );
      await client.invalidateQueries({ queryKey: ["schedule"] });
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      deletionLock.current = false;
      setDeleting(null);
    }
  }
  return (
    <section aria-label="管理事项" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl font-semibold">管理事项</h2>
        <Button disabled={deleting !== null} onClick={() => setEditing("new")}>
          添加事项
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        先登记事项，再按天记录。状态词按最好到最差排列。
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editing === "new" && (
        <ItemForm
          key="new"
          onClose={() => setEditing(null)}
          onSaved={onNotice}
        />
      )}
      {!items.length && editing !== "new" && (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          还没有事项，添加一件要记录的事。
        </p>
      )}
      {items.map((item) => (
        <section
          key={item.id}
          className="min-w-0 rounded-lg border bg-card p-5"
        >
          {editing === item.id ? (
            <ItemForm
              key={item.id}
              item={item}
              onClose={() => setEditing(null)}
              onSaved={onNotice}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-medium">{item.title}</h3>
                  <p className="mt-2 break-words text-sm text-muted-foreground">
                    {item.statuses.join(" → ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleting !== null}
                  onClick={() => setEditing(item.id)}
                >
                  编辑
                </Button>
              </div>
              <div className="mt-5 border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  删除后无法在状态板找回。记录数可能有轻微更新延迟。
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto max-w-full whitespace-normal text-left text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleting !== null}
                  onClick={() => void remove(item)}
                >
                  {deleting === item.id
                    ? "删除中…"
                    : `删除『${item.title}』及其 ${item.entryCount} 条记录`}
                </Button>
              </div>
            </>
          )}
        </section>
      ))}
    </section>
  );
}

function ItemForm({
  item,
  onClose,
  onSaved,
}: {
  item?: ScheduleItemRow;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? "");
  const [statuses, setStatuses] = useState(item?.statuses ?? ["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  async function save() {
    if (locked.current) return;
    const words = statuses.map((word) => word.trim());
    if (
      !title.trim() ||
      title.trim().length > 50 ||
      !words.length ||
      words.length > 8 ||
      words.some((word) => !word || word.length > 30) ||
      new Set(words).size !== words.length
    ) {
      setError("名称需为1–50字；状态词需为1–8项，每项1–30字，不能为空或重复。");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const payload = { title: title.trim(), statuses: words };
      if (item) await scheduleClient.updateItem(item.id, payload);
      else await scheduleClient.createItem(payload);
      onSaved("已保存事项。");
      await client.invalidateQueries({ queryKey: ["schedule"] });
      onClose();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    const copy = [...statuses];
    [copy[index], copy[index + delta]] = [copy[index + delta]!, copy[index]!];
    setStatuses(copy);
  }
  return (
    <form
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 className="font-medium">{item ? "编辑事项" : "添加事项"}</h3>
      <label className="flex flex-col gap-2 text-sm">
        事项名称（必填，最多50字）
        <Input
          autoFocus
          maxLength={50}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "schedule-item-error" : undefined}
        />
      </label>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-sm">状态词（必填，1–8项）</legend>
        {statuses.map((word, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
              {index + 1}
              <Input
                aria-label={`第${index + 1}个状态词`}
                maxLength={30}
                value={word}
                onChange={(event) =>
                  setStatuses(
                    statuses.map((old, position) =>
                      position === index ? event.target.value : old,
                    ),
                  )
                }
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={index === 0}
              aria-label={`上移第${index + 1}个状态`}
              onClick={() => move(index, -1)}
            >
              上移
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={index === statuses.length - 1}
              aria-label={`下移第${index + 1}个状态`}
              onClick={() => move(index, 1)}
            >
              下移
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={statuses.length === 1}
              aria-label={`移除第${index + 1}个状态`}
              onClick={() =>
                setStatuses(
                  statuses.filter((_, position) => position !== index),
                )
              }
            >
              移除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={statuses.length >= 8}
          onClick={() => setStatuses([...statuses, ""])}
        >
          添加状态
        </Button>
      </fieldset>
      <p className="text-xs leading-5 text-muted-foreground">
        按最好到最差排列。顺序影响颜色，不改变已有记录的状态文字。已有记录使用的状态不能移除或改名。
      </p>
      {error && (
        <p
          id="schedule-item-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">关闭将放弃未保存内容。</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          放弃编辑
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "保存中…" : "保存事项"}
        </Button>
      </div>
    </form>
  );
}
