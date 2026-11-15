import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  SlidersHorizontal,
} from "lucide-react";
import { ApiError } from "@toby/contract";
import type {
  ScheduleView,
  ScheduleViewConfig,
  ScheduleViewType,
} from "@toby/contract";
import { scheduleClient } from "@/lib/api.ts";
import { Button } from "@/components/ui/button.tsx";
import { DayStatusPanel } from "./DayStatusPanel.tsx";
import { MonthStatusBoard } from "./MonthStatusBoard.tsx";
import { StatusList } from "./StatusList.tsx";
import { ItemManager } from "./ItemManager.tsx";
import { ViewSettingsPanel } from "./ViewSettingsPanel.tsx";
import {
  DEFAULT_CONFIG,
  describeError,
  filterEntries,
  monthLabel,
  monthRange,
  SELECT_CLASS,
  shiftMonth,
  todayDate,
} from "./schedule-view.ts";

interface ViewDraft {
  id: number | null;
  name: string;
  type: ScheduleViewType;
  config: ScheduleViewConfig;
}
const initialDraft: ViewDraft = {
  id: null,
  name: "",
  type: "calendar",
  config: DEFAULT_CONFIG,
};

export function SchedulePage() {
  const queryClient = useQueryClient();
  const [requestedMonth, setRequestedMonth] = useState(todayDate().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayDate());
  const [draft, setDraft] = useState<ViewDraft>(initialDraft);
  const [original, setOriginal] = useState<ViewDraft>(initialDraft);
  const [settings, setSettings] = useState(false);
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState("");
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const viewLock = useRef(false);
  const itemsQuery = useQuery({
    queryKey: ["schedule", "items"],
    queryFn: () => scheduleClient.listItems(),
  });
  const viewsQuery = useQuery({
    queryKey: ["schedule", "views"],
    queryFn: () => scheduleClient.listViews(),
  });
  const range = monthRange(requestedMonth);
  const entriesQuery = useQuery({
    queryKey: ["schedule", "entries", requestedMonth],
    queryFn: () => scheduleClient.listEntries(range.from, range.to),
    placeholderData: keepPreviousData,
  });
  const items = itemsQuery.data ?? [];
  const views = viewsQuery.data ?? [];
  const saved = views.find((view) => view.id === draft.id);
  const missingView = draft.id !== null && viewsQuery.isSuccess && !saved;
  const dirty =
    !missingView && JSON.stringify(draft) !== JSON.stringify(original);
  const active = missingView
    ? initialDraft
    : !dirty && saved
      ? {
          id: saved.id,
          name: saved.name,
          type: saved.type,
          config: saved.config,
        }
      : draft;
  const shownMonth = entriesQuery.data?.from.slice(0, 7) ?? requestedMonth;
  const date = selectedDate.startsWith(shownMonth)
    ? selectedDate
    : todayDate().startsWith(shownMonth)
      ? todayDate()
      : `${shownMonth}-01`;
  const entries = entriesQuery.data?.entries ?? [];
  const filtered = filterEntries(entries, active.config);
  const ready =
    !!itemsQuery.data &&
    !!entriesQuery.data &&
    !itemsQuery.isError &&
    !entriesQuery.isError &&
    !entriesQuery.isPlaceholderData;
  function selectView(view?: ScheduleView) {
    const value = view
      ? { id: view.id, name: view.name, type: view.type, config: view.config }
      : initialDraft;
    setDraft(value);
    setOriginal(value);
    setViewError(null);
  }
  function configure(config: ScheduleViewConfig) {
    setDraft({ ...active, config });
  }
  function selectDay(value: string) {
    setSelectedDate(value);
  }
  async function saveView(asNew: boolean) {
    if (viewLock.current) return;
    if (!active.name.trim()) {
      setViewError("请填写视图名称。");
      return;
    }
    viewLock.current = true;
    setViewBusy(true);
    setViewError(null);
    try {
      const payload = {
        name: active.name.trim(),
        type: active.type,
        config: active.config,
      };
      const result =
        asNew || active.id === null
          ? await scheduleClient.createView(payload)
          : await scheduleClient.updateView(active.id, payload);
      queryClient.setQueryData<ScheduleView[]>(["schedule", "views"], (old) => [
        ...(old ?? []).filter((view) => view.id !== result.id),
        result,
      ]);
      selectView(result);
      setNotice("已保存视图；事项与记录未改变。");
      await queryClient.invalidateQueries({ queryKey: ["schedule", "views"] });
    } catch (failure) {
      setViewError(describeError(failure));
      if (
        failure instanceof ApiError &&
        failure.code === "SCHEDULE_VIEW_NOT_FOUND"
      ) {
        selectView();
        setNotice("这个视图已不存在，已切换到全部事项。");
      }
    } finally {
      viewLock.current = false;
      setViewBusy(false);
    }
  }
  async function deleteView() {
    if (viewLock.current || active.id === null) return;
    viewLock.current = true;
    setViewBusy(true);
    setViewError(null);
    try {
      await scheduleClient.deleteView(active.id);
      selectView();
      setNotice("已删除视图，事项与记录会保留。");
      await queryClient.invalidateQueries({ queryKey: ["schedule", "views"] });
    } catch (failure) {
      setViewError(describeError(failure));
      if (
        failure instanceof ApiError &&
        failure.code === "SCHEDULE_VIEW_NOT_FOUND"
      ) {
        selectView();
        setNotice("这个视图已不存在，已切换到全部事项。");
      }
    } finally {
      viewLock.current = false;
      setViewBusy(false);
    }
  }
  function showAllDay(value: string) {
    selectDay(value);
    document
      .getElementById("schedule-day-panel")
      ?.scrollIntoView({ block: "nearest" });
    document.getElementById("schedule-day-panel")?.focus();
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-12">
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              每日状态板
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              按天记录每件事的状态。
            </p>
          </div>
          <Button variant="outline" onClick={() => setManaging(!managing)}>
            {managing ? "返回状态板" : "管理事项"}
          </Button>
        </header>
        <div
          role="status"
          aria-live="polite"
          className={
            notice
              ? "rounded-lg bg-accent-soft px-4 py-3 text-sm leading-6"
              : "sr-only"
          }
        >
          {notice}
        </div>
        {itemsQuery.error && (
          <ErrorCard
            title="无法读取事项"
            error={itemsQuery.error}
            fetching={itemsQuery.isFetching}
            onRetry={() => void itemsQuery.refetch()}
          />
        )}
        {managing ? (
          itemsQuery.isPending ? (
            <Loading text="正在读取事项…" />
          ) : itemsQuery.data ? (
            <ItemManager
              items={items}
              onNotice={(text) => {
                setNotice(text);
              }}
            />
          ) : null
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 items-center gap-2 text-sm">
                视图
                <select
                  className={`${SELECT_CLASS} max-w-56`}
                  value={active.id ?? ""}
                  disabled={viewBusy}
                  onChange={(event) =>
                    selectView(
                      views.find(
                        (view) => view.id === Number(event.target.value),
                      ),
                    )
                  }
                >
                  <option value="">全部事项</option>
                  {views.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.type === "calendar" ? "▦" : "≡"} {view.name}
                    </option>
                  ))}
                </select>
              </label>
              <div
                role="group"
                aria-label="呈现方式"
                className="flex gap-1 rounded-lg border p-1"
              >
                {(["calendar", "list"] as const).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={active.type === type ? "secondary" : "ghost"}
                    aria-pressed={active.type === type}
                    disabled={viewBusy}
                    onClick={() => setDraft({ ...active, type })}
                  >
                    {type === "calendar" ? (
                      <CalendarDays className="size-4" />
                    ) : (
                      <List className="size-4" />
                    )}
                    {type === "calendar" ? "月历" : "列表"}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={viewBusy}
                aria-expanded={settings}
                onClick={() => setSettings(!settings)}
              >
                <SlidersHorizontal className="size-4" />
                视图设置
              </Button>
              {dirty && (
                <span className="text-xs text-muted-foreground">未保存</span>
              )}
            </div>
            {viewsQuery.error && (
              <ErrorCard
                title="个人视图未读取，全部事项仍可使用"
                error={viewsQuery.error}
                fetching={viewsQuery.isFetching}
                onRetry={() => void viewsQuery.refetch()}
              />
            )}
            {missingView && (
              <p role="status" className="text-sm text-muted-foreground">
                这个视图不存在，可能已被删除。已切换到全部事项。
              </p>
            )}
            {dirty && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>更改尚未保存；切换视图将放弃临时配置。</span>
                {active.id !== null && (
                  <Button
                    size="sm"
                    disabled={viewBusy}
                    onClick={() => void saveView(false)}
                  >
                    保存更改
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSettings(true)}
                >
                  另存为
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={viewBusy}
                  onClick={() => selectView(saved)}
                >
                  还原
                </Button>
              </div>
            )}
            {settings && (
              <ViewSettingsPanel
                name={active.name}
                type={active.type}
                config={active.config}
                items={items}
                busy={viewBusy}
                error={viewError}
                selected={active.id !== null}
                dirty={dirty}
                onName={(name) => setDraft({ ...active, name })}
                onConfig={configure}
                onSave={(asNew) => void saveView(asNew)}
                onDelete={() => void deleteView()}
                onRestore={() => selectView(saved)}
              />
            )}
            {!settings && viewError && (
              <p role="alert" className="text-sm text-destructive">
                {viewError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                事项：
                {active.config.itemIds?.length
                  ? active.config.itemIds
                      .map(
                        (id) =>
                          items.find((item) => String(item.id) === id)?.title ??
                          `#${id}`,
                      )
                      .join("、")
                  : "全部"}
              </span>
              <span>
                状态：
                {active.config.statuses?.length
                  ? active.config.statuses.join("、")
                  : "全部"}
              </span>
              {(!!active.config.itemIds?.length ||
                !!active.config.statuses?.length) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={viewBusy}
                  onClick={() =>
                    configure({ ...active.config, itemIds: [], statuses: [] })
                  }
                >
                  清除筛选
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一月"
                  disabled={entriesQuery.isFetching}
                  onClick={() => setRequestedMonth(shiftMonth(shownMonth, -1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <h2 className="px-2 font-serif text-base font-semibold">
                  {monthLabel(shownMonth)}
                </h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一月"
                  disabled={entriesQuery.isFetching}
                  onClick={() => setRequestedMonth(shiftMonth(shownMonth, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={entriesQuery.isFetching}
                  onClick={() => {
                    setRequestedMonth(todayDate().slice(0, 7));
                    selectDay(todayDate());
                  }}
                >
                  今天
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                {entriesQuery.isFetching
                  ? entriesQuery.isPlaceholderData
                    ? `正在读取${monthLabel(requestedMonth)}…`
                    : "更新中…"
                  : `本月匹配 ${filtered.length} 条记录`}
              </span>
            </div>
            {entriesQuery.error && (
              <ErrorCard
                title={
                  entriesQuery.data
                    ? "更新失败，显示上次读取结果"
                    : "无法读取日程记录"
                }
                error={entriesQuery.error}
                fetching={entriesQuery.isFetching}
                onRetry={() => void entriesQuery.refetch()}
              />
            )}
            {entriesQuery.isPending ? (
              <Loading text="正在读取日程…" />
            ) : (
              entriesQuery.data && (
                <>
                  {!items.length && itemsQuery.isSuccess && (
                    <div className="rounded-lg border bg-card p-6 text-center">
                      <p className="mb-3 text-sm text-muted-foreground">
                        先登记一件要记录的事。
                      </p>
                      <Button onClick={() => setManaging(true)}>
                        添加事项
                      </Button>
                    </div>
                  )}
                  {active.type === "calendar" ? (
                    <div className="grid min-w-0 items-start gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_336px]">
                      <MonthStatusBoard
                        month={shownMonth}
                        date={date}
                        entries={filtered}
                        allEntries={entries}
                        items={items}
                        onSelect={selectDay}
                      />
                      <DayStatusPanel
                        date={date}
                        items={items}
                        entries={entries}
                        ready={ready}
                        onNotice={setNotice}
                      />
                    </div>
                  ) : (
                    <>
                      <StatusList
                        entries={filtered}
                        items={items}
                        config={active.config}
                        ready={ready}
                        onSelect={showAllDay}
                        onNotice={setNotice}
                      />
                      <DayStatusPanel
                        date={date}
                        items={items}
                        entries={entries}
                        ready={ready}
                        onNotice={setNotice}
                      />
                    </>
                  )}
                  {!filtered.length && (
                    <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                      {entries.length
                        ? "当前条件下没有记录。可清除筛选，或在当日栏填写。"
                        : "本月还没有记录。选择日期，在当日栏设置状态。"}
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border bg-card px-5 py-10 text-center text-sm text-muted-foreground"
    >
      {text}
    </p>
  );
}
function ErrorCard({
  title,
  error,
  fetching,
  onRetry,
}: {
  title: string;
  error: unknown;
  fetching: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-lg border border-destructive/30 bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <p role="alert" className="mt-1 text-sm text-muted-foreground">
        {describeError(error)}
      </p>
      <Button
        className="mt-3"
        size="sm"
        variant="outline"
        disabled={fetching}
        onClick={onRetry}
      >
        {fetching ? "读取中…" : "重试读取"}
      </Button>
    </section>
  );
}
