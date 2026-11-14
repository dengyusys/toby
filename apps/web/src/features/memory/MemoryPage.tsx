/**
 * Memory route ("/memory"): MEMORY.md rendered as a butler's memo, not a
 * database grid. Live entries keep the file's 约定 → 关于我 → 人物 order;
 * expired lines form the last group, where editing the date renews them.
 * Every direct write is an exact-line replace and returns a visible receipt.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useState } from "react";
import type {
  MemoryEntry,
  MemoryEntryView,
  MemoryReceipt,
  MemoryType,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { memoryClient } from "@/lib/api.ts";
import { MemoryReceiptCard } from "./MemoryReceiptCard.tsx";
import {
  describeError,
  entryKey,
  entryLabel,
  exactEntry,
  isMemoryFileInvalid,
} from "./memory-view.ts";

const MEMORY_TYPES: readonly MemoryType[] = ["约定", "关于我", "人物"];

const EMPTY_HINTS: Record<MemoryType, string> = {
  约定: "还没记住什么约定",
  关于我: "还没记住关于你的事",
  人物: "还没记住什么人物",
};

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-faint focus:border-foreground/40 disabled:opacity-50";
const LABEL_CLASS = "flex flex-col gap-1.5 text-xs text-muted-foreground";

interface Draft {
  name: string;
  text: string;
  until: string;
}

type EditorTarget =
  | { kind: "add"; type: MemoryType }
  | { kind: "edit"; key: string; entry: MemoryEntryView };

interface SaveVariables {
  target: EditorTarget;
  entry: MemoryEntry;
}

interface RowError {
  key: string;
  message: string;
}

function emptyDraft(): Draft {
  return { name: "", text: "", until: "" };
}

function draftOf(entry: MemoryEntryView): Draft {
  return { name: entry.name ?? "", text: entry.text, until: entry.until ?? "" };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validateDraft(type: MemoryType, draft: Draft): string | null {
  if (type === "人物" && draft.name.trim() === "") return "请填写姓名";
  if (draft.text.trim() === "") return "请填写内容";
  if (draft.until !== "" && !validDate(draft.until)) {
    return "请输入有效日期，格式为 YYYY-MM-DD";
  }
  return null;
}

function entryFromDraft(type: MemoryType, draft: Draft): MemoryEntry {
  const until = draft.until.trim();
  return {
    type,
    text: draft.text.trim(),
    ...(type === "人物" ? { name: draft.name.trim() } : {}),
    ...(until === "" ? {} : { until }),
  };
}

interface MemoryEditorProps {
  type: MemoryType;
  draft: Draft;
  pending: boolean;
  error: string | null;
  onChange: (field: keyof Draft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function MemoryEditor({
  type,
  draft,
  pending,
  error,
  onChange,
  onSave,
  onCancel,
}: MemoryEditorProps) {
  return (
    <form
      className="border-b border-border bg-accent-soft/35 px-4 py-3.5"
      aria-label={type === "人物" ? "编辑人物记忆" : "编辑记忆"}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {type === "人物" && (
          <label className={LABEL_CLASS}>
            姓名
            <input
              className={INPUT_CLASS}
              value={draft.name}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => onChange("name", event.target.value)}
            />
          </label>
        )}
        <label className={LABEL_CLASS}>
          内容
          <input
            className={INPUT_CLASS}
            value={draft.text}
            disabled={pending}
            autoComplete="off"
            autoFocus={type !== "人物"}
            onChange={(event) => onChange("text", event.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          至日期（可选）
          <input
            type="date"
            className={`${INPUT_CLASS} font-mono tabular-nums`}
            value={draft.until}
            disabled={pending}
            onChange={(event) => onChange("until", event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={onCancel}
          className="text-muted-foreground"
        >
          取消
        </Button>
        <Button type="submit" size="xs" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}

export function MemoryPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["memory"],
    queryFn: () => memoryClient.list(),
  });
  const offRecordQuery = useQuery({
    queryKey: ["memory", "off-record"],
    queryFn: () => memoryClient.getOffRecord(),
  });

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [lastReceipt, setLastReceipt] = useState<MemoryReceipt | null>(null);

  function clearWorkbench() {
    setEditor(null);
    setDraft(null);
    setEditorError(null);
    setConfirmingKey(null);
    setRowError(null);
  }

  function openEditor(target: EditorTarget, nextDraft: Draft) {
    clearWorkbench();
    setLastReceipt(null);
    setEditor(target);
    setDraft(nextDraft);
  }

  const saveMutation = useMutation({
    mutationFn: ({ target, entry }: SaveVariables) =>
      target.kind === "add"
        ? memoryClient.remember(entry)
        : memoryClient.replaceExact(exactEntry(target.entry), entry),
    onSuccess: (receipt) => {
      clearWorkbench();
      setLastReceipt(receipt);
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
    onError: (error) => setEditorError(describeError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: MemoryEntryView) =>
      memoryClient.replaceExact(exactEntry(entry), null),
    onSuccess: (receipt) => {
      clearWorkbench();
      setLastReceipt(receipt);
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
    onError: (error, entry) => {
      setConfirmingKey(null);
      setRowError({ key: entryKey(entry), message: describeError(error) });
    },
  });

  const offRecordMutation = useMutation({
    mutationFn: (on: boolean) => memoryClient.setOffRecord(on),
    onSuccess: (state) => {
      queryClient.setQueryData(["memory", "off-record"], state);
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => memoryClient.exportMarkdown(),
    onSuccess: (markdown) => {
      const url = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "MEMORY.md";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((current) =>
      current === null ? current : { ...current, [field]: value },
    );
    setEditorError(null);
  }

  function saveEditor() {
    if (editor === null || draft === null) return;
    const type = editor.kind === "add" ? editor.type : editor.entry.type;
    const error = validateDraft(type, draft);
    if (error !== null) {
      setEditorError(error);
      return;
    }
    saveMutation.mutate({ target: editor, entry: entryFromDraft(type, draft) });
  }

  const offRecord = offRecordQuery.data?.on;
  const entries = listQuery.data?.entries ?? [];
  const expiredEntries = entries.filter((entry) => entry.expired);

  function renderEditor(type: MemoryType) {
    if (draft === null) return null;
    return (
      <MemoryEditor
        type={type}
        draft={draft}
        pending={saveMutation.isPending}
        error={editorError}
        onChange={updateDraft}
        onSave={saveEditor}
        onCancel={clearWorkbench}
      />
    );
  }

  function renderEntry(entry: MemoryEntryView) {
    const key = entryKey(entry);
    const editing = editor?.kind === "edit" && editor.key === key;
    const confirming = confirmingKey === key;

    return (
      <li key={key} className="px-4 py-2.5">
        {editing ? (
          <div className="-mx-4 -my-2.5">{renderEditor(entry.type)}</div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span
                aria-hidden="true"
                className="shrink-0 font-mono text-sm text-faint"
              >
                -
              </span>
              <p
                className={`min-w-0 break-words text-sm leading-6 ${
                  entry.expired ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {entry.expired && (
                  <span className="mr-2 rounded-sm bg-surface-hover px-1.5 py-0.5 text-[11px] leading-4 text-faint">
                    {entry.type}
                  </span>
                )}
                {entry.type === "人物" && (
                  <span className="font-medium">{entry.name}:</span>
                )}
                {entry.type === "人物" ? " " : ""}
                {entry.text}
                {entry.until && (
                  <span className="ml-2 whitespace-nowrap text-xs text-faint">
                    至 {entry.until}
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {confirming ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(entry)}
                  >
                    {deleteMutation.isPending ? "删除中…" : "确认删除"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmingKey(null)}
                    className="text-muted-foreground"
                  >
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`编辑 ${entryLabel(entry)}`}
                    onClick={() =>
                      openEditor({ kind: "edit", key, entry }, draftOf(entry))
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`删除 ${entryLabel(entry)}`}
                    onClick={() => {
                      clearWorkbench();
                      setLastReceipt(null);
                      setConfirmingKey(key);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {rowError?.key === key && !editing && (
          <p role="alert" className="mt-1.5 text-xs leading-5 text-destructive">
            {rowError.message}
          </p>
        )}
      </li>
    );
  }

  function renderSection(type: MemoryType) {
    const sectionEntries = entries.filter(
      (entry) => entry.type === type && !entry.expired,
    );
    const adding = editor?.kind === "add" && editor.type === type;
    return (
      <section
        key={type}
        aria-labelledby={`memory-${type}`}
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-hover/45 px-4 py-2.5">
          <div className="flex items-baseline gap-2.5">
            <h2
              id={`memory-${type}`}
              className="font-serif text-base font-semibold"
            >
              {type}
            </h2>
            {sectionEntries.length > 0 && (
              <span className="text-xs text-faint">
                {sectionEntries.length} 条
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`添加${type}`}
            onClick={() => openEditor({ kind: "add", type }, emptyDraft())}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            添加
          </Button>
        </div>
        {adding && renderEditor(type)}
        {sectionEntries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-faint">{EMPTY_HINTS[type]}</p>
        ) : (
          <ul className="divide-y divide-border">
            {sectionEntries.map(renderEntry)}
          </ul>
        )}
      </section>
    );
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
              管家的备忘录，记下约定、你和重要的人。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              <Download className="size-3.5" />
              {exportMutation.isPending ? "导出中…" : "导出 .md"}
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
        {exportMutation.error && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            导出失败：{describeError(exportMutation.error)}
          </p>
        )}
        {lastReceipt && (
          <div role="status">
            <MemoryReceiptCard receipt={lastReceipt} compact />
          </div>
        )}

        {listQuery.isPending ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            正在读取备忘录…
          </div>
        ) : listQuery.error ? (
          <section className="rounded-xl border border-destructive/30 bg-card p-6 shadow-sm">
            <h2 className="font-serif text-lg font-semibold">
              {isMemoryFileInvalid(listQuery.error)
                ? "记忆文件需要修复"
                : "无法显示记忆"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {describeError(listQuery.error)}
              {isMemoryFileInvalid(listQuery.error) &&
                "。页面不会改写或跳过无法读取的内容，修复后请重新读取。"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              {listQuery.isFetching ? "读取中…" : "重新读取"}
            </Button>
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              {MEMORY_TYPES.map(renderSection)}
            </div>
            {expiredEntries.length > 0 && (
              <section
                aria-labelledby="memory-expired"
                className="overflow-hidden rounded-xl border border-border bg-muted/30"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
                  <h2
                    id="memory-expired"
                    className="font-serif text-base font-semibold text-muted-foreground"
                  >
                    已过期
                  </h2>
                  <p className="text-xs text-faint">
                    修改日期可续期，也可以删除。
                  </p>
                </div>
                <ul className="divide-y divide-border">
                  {expiredEntries.map(renderEntry)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
