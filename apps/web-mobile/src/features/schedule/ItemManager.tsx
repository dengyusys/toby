import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@toby/contract";
import type { ScheduleItemRow } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { scheduleClient } from "@/lib/api.ts";
import { describeError, fieldClass } from "./schedule-view.ts";

export function ItemManager({
  items,
  onBack,
  onNotice,
}: {
  items: ScheduleItemRow[];
  onBack: () => void;
  onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ScheduleItemRow | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [statuses, setStatuses] = useState(["", ""]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"title" | "statuses" | null>(null);
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setKeyboardInset(
        Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop),
      );
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  function open(item: ScheduleItemRow | "new") {
    setEditing(item);
    setTitle(item === "new" ? "" : item.title);
    setStatuses(item === "new" ? ["", ""] : [...item.statuses]);
    setError("");
    setInvalid(null);
    setMissing(false);
  }
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["schedule"] });
  }
  async function save() {
    if (!editing || pending || missing) return;
    const trimmed = title.trim();
    const words = statuses.map((status) => status.trim());
    const titleInvalid =
      !trimmed ||
      trimmed.length > 50 ||
      items.some(
        (item) =>
          item.title === trimmed &&
          (editing === "new" || item.id !== editing.id),
      );
    const wordsInvalid =
      !words.length ||
      words.length > 8 ||
      words.some((word) => !word || word.length > 30) ||
      new Set(words).size !== words.length;
    if (titleInvalid || wordsInvalid) {
      setInvalid(titleInvalid ? "title" : "statuses");
      setError(
        titleInvalid
          ? "请输入 1–50 字的事项名称，且不能与已有事项重名。"
          : "请填写 1–8 个不重复的状态词，每个 1–30 字。",
      );
      document
        .getElementById(titleInvalid ? "schedule-title" : "schedule-status-0")
        ?.focus();
      return;
    }
    setPending(true);
    setError("");
    setInvalid(null);
    try {
      if (editing === "new")
        await scheduleClient.createItem({ title: trimmed, statuses: words });
      else
        await scheduleClient.updateItem(editing.id, {
          title: trimmed,
          statuses: words,
        });
      setEditing(null);
      onNotice(`已保存事项「${trimmed}」`);
      await refresh();
    } catch (cause) {
      setError(`保存失败：${describeError(cause)}`);
      if (
        cause instanceof ApiError &&
        cause.code === "SCHEDULE_ITEM_NOT_FOUND"
      ) {
        setMissing(true);
        void refresh();
      }
      if (
        cause instanceof ApiError &&
        cause.code === "SCHEDULE_ITEM_DUPLICATE"
      ) {
        setInvalid("title");
        document.getElementById("schedule-title")?.focus();
      }
    } finally {
      setPending(false);
    }
  }
  async function remove(item: ScheduleItemRow) {
    if (deleting !== null) return;
    setDeleting(item.id);
    setError("");
    try {
      const result = await scheduleClient.deleteItem(item.id);
      onNotice(
        `已删除『${item.title}』及其 ${result.deletedEntries} 条记录。事项已删除，视图筛选已更新。`,
      );
      await refresh();
    } catch (cause) {
      setError(`删除事项失败：${describeError(cause)}`);
    } finally {
      setDeleting(null);
    }
  }
  return (
    <section className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        disabled={pending}
        onClick={onBack}
      >
        ← 返回状态板
      </Button>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          管理事项
        </h1>
        {!editing && (
          <Button
            type="button"
            className="min-h-11"
            onClick={() => open("new")}
          >
            添加事项
          </Button>
        )}
      </header>
      {editing ? (
        <form
          id="schedule-item-form"
          className="space-y-5 rounded-xl border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="font-serif text-lg font-semibold">
            {editing === "new" ? "添加事项" : "编辑事项"}
          </h2>
          <label className="block space-y-2" htmlFor="schedule-title">
            <span className="text-sm font-medium">名称（必填）</span>
            <input
              id="schedule-title"
              autoFocus
              required
              maxLength={50}
              className={fieldClass}
              value={title}
              disabled={pending || missing}
              aria-invalid={invalid === "title"}
              aria-describedby={error ? "schedule-form-error" : undefined}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：锻炼"
            />
          </label>
          <fieldset
            disabled={pending || missing}
            aria-describedby="schedule-vocab-help"
          >
            <legend className="mb-2 text-sm font-medium">
              状态词（必填，按最好到最差排列）
            </legend>
            <p
              id="schedule-vocab-help"
              className="mb-3 text-sm leading-6 text-muted-foreground"
            >
              每天只能选择一个状态。顺序影响颜色，不改变已有记录的状态文字。
            </p>
            <div className="space-y-3">
              {statuses.map((status, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border bg-background p-3"
                >
                  <label
                    className="flex items-center gap-2"
                    htmlFor={`schedule-status-${index}`}
                  >
                    <span className="font-mono text-sm text-muted-foreground">
                      {index + 1}
                    </span>
                    <input
                      id={`schedule-status-${index}`}
                      aria-label={`第 ${index + 1} 个状态词`}
                      required
                      maxLength={30}
                      className={fieldClass}
                      value={status}
                      aria-invalid={invalid === "statuses"}
                      aria-describedby={
                        error ? "schedule-form-error" : undefined
                      }
                      placeholder={index === 0 ? "例如：完成" : "填写状态词"}
                      onChange={(event) =>
                        setStatuses(
                          statuses.map((word, position) =>
                            position === index ? event.target.value : word,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[-1, 1].map((offset) => (
                      <Button
                        key={offset}
                        type="button"
                        variant="outline"
                        className="min-h-11 min-w-11"
                        disabled={
                          index + offset < 0 ||
                          index + offset >= statuses.length
                        }
                        aria-label={`第 ${index + 1} 个状态词${offset < 0 ? "上移" : "下移"}`}
                        onClick={() => {
                          const next = [...statuses];
                          [next[index], next[index + offset]] = [
                            next[index + offset]!,
                            next[index]!,
                          ];
                          setStatuses(next);
                        }}
                      >
                        {offset < 0 ? "上移" : "下移"}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 text-muted-foreground"
                      disabled={statuses.length === 1}
                      aria-label={`移除第 ${index + 1} 个状态词`}
                      onClick={() =>
                        setStatuses(
                          statuses.filter((_, position) => position !== index),
                        )
                      }
                    >
                      移除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-3 min-h-11"
              disabled={statuses.length >= 8}
              onClick={() => setStatuses([...statuses, ""])}
            >
              添加状态
            </Button>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            放弃编辑或返回会丢弃尚未保存的修改。
          </p>
          {error && (
            <p
              id="schedule-form-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div
            style={{ bottom: keyboardInset }}
            className="fixed inset-x-0 z-10 flex gap-3 border-t bg-card px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
          >
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1"
              disabled={pending}
              onClick={() => {
                setEditing(null);
                setError("");
              }}
            >
              放弃编辑
            </Button>
            <Button
              type="submit"
              className="min-h-11 flex-1"
              disabled={pending || missing}
            >
              {pending ? "保存中…" : "保存事项"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!items.length && (
            <p className="rounded-xl border p-5 text-sm text-muted-foreground">
              先登记一件要记录的事。
            </p>
          )}
          {items.map((item) => (
            <article
              key={item.id}
              className="min-w-0 rounded-xl border bg-card p-4"
            >
              <h2 className="font-medium break-words">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 break-words text-muted-foreground">
                状态：{item.statuses.join(" → ")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-11"
                disabled={deleting !== null}
                onClick={() => open(item)}
              >
                编辑
              </Button>
              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  删除后无法在状态板找回
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 max-w-full justify-start whitespace-normal text-destructive"
                  disabled={deleting !== null}
                  onClick={() => void remove(item)}
                >
                  {deleting === item.id
                    ? "删除中…"
                    : `删除『${item.title}』及其 ${item.entryCount} 条记录`}
                </Button>
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
