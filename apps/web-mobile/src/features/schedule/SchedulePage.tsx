import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ScheduleViewConfig } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { scheduleClient } from "@/lib/api.ts";
import { AgendaFilterPanel } from "./AgendaFilterPanel.tsx";
import { ItemManager } from "./ItemManager.tsx";
import { ItemStatusControl } from "./ItemStatusControl.tsx";
import {
  allConfig,
  dateLabel,
  describeError,
  fieldClass,
  matches,
  monthRange,
  moveMonth,
  statusClass,
  todayLocal,
} from "./schedule-view.ts";

export function SchedulePage() {
  const today = todayLocal();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [viewId, setViewId] = useState("");
  const [override, setOverride] = useState<ScheduleViewConfig | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [notice, setNotice] = useState("");
  const [jump, setJump] = useState<string | null>(today);
  const scrollRef = useRef<HTMLDivElement>(null);
  const range = monthRange(month);
  const itemsQuery = useQuery({
    queryKey: ["schedule", "items"],
    queryFn: () => scheduleClient.listItems(),
  });
  const entriesQuery = useQuery({
    queryKey: ["schedule", "entries", month],
    queryFn: () => scheduleClient.listEntries(range.from, range.to),
    placeholderData: keepPreviousData,
  });
  const viewsQuery = useQuery({
    queryKey: ["schedule", "views"],
    queryFn: () => scheduleClient.listViews(),
  });
  const shownMonth = entriesQuery.data?.from.slice(0, 7) ?? month;
  const items = itemsQuery.data ?? [];
  const entries = entriesQuery.data?.entries ?? [];
  const views = viewsQuery.data ?? [];
  const chosenView = views.find((view) => String(view.id) === viewId);
  const validConfig =
    chosenView === undefined ||
    (chosenView.config &&
      ["date", "title"].includes(chosenView.config.sort) &&
      ["none", "item", "status"].includes(chosenView.config.group) &&
      (!chosenView.config.itemIds ||
        chosenView.config.itemIds.every((id) => typeof id === "string")) &&
      (!chosenView.config.statuses ||
        chosenView.config.statuses.every(
          (status) => typeof status === "string",
        )));
  const config =
    override ?? (validConfig ? chosenView?.config : null) ?? allConfig;
  const filtered = entries.filter((entry) => matches(entry, config));
  const dates = [
    ...new Set([
      ...filtered.map((entry) => entry.date),
      ...expanded.filter((date) => date.startsWith(shownMonth)),
      ...(today.startsWith(shownMonth) ? [today] : []),
      ...(selected.startsWith(shownMonth) ? [selected] : []),
    ]),
  ]
    .sort()
    .reverse();
  const canEdit =
    !!itemsQuery.data &&
    !itemsQuery.isError &&
    !!entriesQuery.data &&
    !entriesQuery.isError &&
    !entriesQuery.isPlaceholderData;

  useEffect(() => {
    if (!viewId || !viewsQuery.isSuccess || chosenView) return;
    setViewId("");
    setOverride(null);
    setNotice("这个视图不存在，可能已被删除。已切换到全部事项。");
  }, [viewId, viewsQuery.isSuccess, chosenView]);
  useEffect(() => {
    if (
      !jump ||
      entriesQuery.isPlaceholderData ||
      !entriesQuery.data ||
      !jump.startsWith(shownMonth) ||
      managing
    )
      return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`schedule-day-${jump}`);
      if (element && scrollRef.current)
        scrollRef.current.scrollTop =
          element.offsetTop - scrollRef.current.offsetTop - 12;
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    jump,
    shownMonth,
    entriesQuery.data,
    entriesQuery.isPlaceholderData,
    managing,
  ]);

  function chooseDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setMonth(date.slice(0, 7));
    setSelected(date);
    setExpanded((old) => (old.includes(date) ? old : [...old, date]));
    setJump(date);
  }
  function navigate(delta: number) {
    const next = moveMonth(shownMonth, delta);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
    setJump(null);
  }
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-w-0 flex-col gap-4 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
          {managing ? (
            <ItemManager
              items={items}
              onBack={() => setManaging(false)}
              onNotice={setNotice}
            />
          ) : (
            <>
              <header>
                <h1 className="font-serif text-2xl font-semibold tracking-tight">
                  每日状态板
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  按天记录每件事的状态
                </p>
              </header>
              <div className="flex flex-wrap items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">选择已有视图</span>
                  <select
                    className={fieldClass}
                    value={viewId}
                    onChange={(event) => {
                      setViewId(event.target.value);
                      setOverride(null);
                    }}
                  >
                    <option value="">全部事项</option>
                    {views.map((view) => (
                      <option key={view.id} value={view.id}>
                        {view.type === "calendar" ? "▦" : "☷"} {view.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  aria-expanded={filterOpen}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  筛选
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={!itemsQuery.data}
                  onClick={() => setManaging(true)}
                >
                  管理事项
                </Button>
              </div>
              {chosenView && (
                <p className="text-xs text-muted-foreground">
                  手机按日期显示；排序与分组仅 PC 列表生效。
                  {override && " 当前使用临时筛选。"}
                </p>
              )}
              {!validConfig && (
                <div role="alert" className="rounded-lg border p-3 text-sm">
                  视图设置不正确，已显示内置议程。
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 min-h-11"
                    onClick={() => {
                      setViewId("");
                      setOverride(null);
                    }}
                  >
                    回到全部事项
                  </Button>
                </div>
              )}
              {viewsQuery.error && (
                <div role="alert" className="text-sm text-destructive">
                  个人视图读取失败：{describeError(viewsQuery.error)}{" "}
                  内置全部事项仍可用。
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 min-h-11"
                    disabled={viewsQuery.isFetching}
                    onClick={() => void viewsQuery.refetch()}
                  >
                    重试读取视图
                  </Button>
                </div>
              )}
              {filterOpen && (
                <AgendaFilterPanel
                  items={items}
                  config={config}
                  onChange={setOverride}
                  onRestore={() => setOverride(null)}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="size-11"
                  aria-label="上个月"
                  onClick={() => navigate(-1)}
                >
                  <ChevronLeft />
                </Button>
                <h2 className="flex-1 text-center font-serif text-lg">
                  {shownMonth.slice(0, 4)}年{Number(shownMonth.slice(5))}月
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  className="size-11"
                  aria-label="下个月"
                  onClick={() => navigate(1)}
                >
                  <ChevronRight />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => chooseDate(today)}
                >
                  今天
                </Button>
              </div>
              <label className="flex min-w-0 items-center gap-3 text-sm">
                <span className="shrink-0">选日期</span>
                <input
                  type="date"
                  aria-label="选择要填写的日期"
                  className={fieldClass}
                  value={selected}
                  onChange={(event) => chooseDate(event.target.value)}
                />
              </label>
              {entriesQuery.isFetching && (
                <p role="status" className="text-sm text-muted-foreground">
                  {entriesQuery.isPlaceholderData
                    ? `正在读取 ${month}，暂保留上个月内容…`
                    : entriesQuery.data
                      ? "记录更新中…"
                      : "正在读取记录…"}
                </p>
              )}
              {itemsQuery.isPending && (
                <p
                  role="status"
                  className="rounded-xl border p-5 text-sm text-muted-foreground"
                >
                  正在读取事项…
                </p>
              )}
              {itemsQuery.error && (
                <div role="alert" className="rounded-xl border p-4 text-sm">
                  <p>
                    事项读取失败：{describeError(itemsQuery.error)}{" "}
                    已有记录可只读查看，暂不能设置状态。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 min-h-11"
                    disabled={itemsQuery.isFetching}
                    onClick={() => void itemsQuery.refetch()}
                  >
                    重新读取事项
                  </Button>
                </div>
              )}
              {entriesQuery.error && (
                <div role="alert" className="rounded-xl border p-4 text-sm">
                  <p>
                    {entriesQuery.data
                      ? "记录已保留，列表更新失败。请重新读取后继续填写。"
                      : "记录读取失败，尚不能确定当天状态。"}
                    {describeError(entriesQuery.error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 min-h-11"
                    disabled={entriesQuery.isFetching}
                    onClick={() => void entriesQuery.refetch()}
                  >
                    重新读取记录
                  </Button>
                </div>
              )}
              {itemsQuery.isSuccess && !items.length && (
                <div className="rounded-xl border bg-card p-5">
                  <p className="text-sm text-muted-foreground">
                    先登记一件要记录的事
                  </p>
                  <Button
                    type="button"
                    className="mt-4 min-h-11"
                    onClick={() => setManaging(true)}
                  >
                    添加事项
                  </Button>
                </div>
              )}
              {entriesQuery.data && !entries.length && (
                <p className="text-sm text-muted-foreground">
                  本月还没有记录，可选择日期开始填写。
                </p>
              )}
              {entries.length > 0 && !filtered.length && (
                <div className="rounded-lg border p-3 text-sm">
                  <p>没有匹配记录。今天与展开的日期仍可填写全部事项。</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 min-h-11"
                    onClick={() => setOverride(allConfig)}
                  >
                    清除筛选
                  </Button>
                </div>
              )}
              {entriesQuery.data &&
                dates.map((date) => {
                  const isExpanded = date === today || expanded.includes(date);
                  const dayEntries = entries.filter(
                    (entry) => entry.date === date,
                  );
                  const shownEntries = filtered.filter(
                    (entry) => entry.date === date,
                  );
                  return (
                    <section
                      key={date}
                      id={`schedule-day-${date}`}
                      className="scroll-mt-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="font-mono text-sm font-medium">
                          {dateLabel(date)}
                          {date === today && " · 今天"}
                        </h2>
                        {date !== today && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11"
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpanded((old) =>
                                old.includes(date)
                                  ? old.filter((value) => value !== date)
                                  : [...old, date],
                              )
                            }
                          >
                            {isExpanded ? "收起填写" : "填写这天"}
                          </Button>
                        )}
                      </div>
                      <div className="min-w-0 rounded-xl border bg-card px-4">
                        {isExpanded && (
                          <div className="border-b py-3">
                            <p className="text-sm font-medium">
                              全部事项 · 已记{dayEntries.length}/{items.length}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              视图筛选仅影响折叠列表，不影响这里的填写。
                            </p>
                          </div>
                        )}
                        {isExpanded && canEdit ? (
                          <div className="divide-y">
                            {items.map((item) => (
                              <ItemStatusControl
                                key={`${date}-${item.id}`}
                                item={item}
                                date={date}
                                entry={dayEntries.find(
                                  (entry) => entry.itemId === item.id,
                                )}
                                onNotice={setNotice}
                              />
                            ))}
                            {!items.length && (
                              <p className="py-4 text-sm text-muted-foreground">
                                请先添加事项。
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="divide-y">
                            {(isExpanded ? dayEntries : shownEntries).map(
                              (entry) => (
                                <div
                                  key={entry.id}
                                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-4"
                                >
                                  <span className="min-w-0 text-sm break-words">
                                    {items.find(
                                      (item) => item.id === entry.itemId,
                                    )?.title ?? entry.title}
                                  </span>
                                  <span
                                    className={`max-w-full rounded-md px-2 py-1 text-sm break-words ${statusClass(items.find((item) => item.id === entry.itemId)?.statuses ?? [], entry.status)}`}
                                  >
                                    ● {entry.status}
                                  </span>
                                </div>
                              ),
                            )}
                            {!(isExpanded ? dayEntries : shownEntries)
                              .length && (
                              <p className="py-4 text-sm text-muted-foreground">
                                {!canEdit && isExpanded
                                  ? "读取完成后可填写状态。"
                                  : dayEntries.length
                                    ? "无匹配记录"
                                    : "未记录"}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
            </>
          )}
          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border bg-accent-soft p-3 text-sm leading-6 break-words"
            >
              {notice}
            </p>
          )}
        </div>
      </div>
      {!managing && (
        <div className="shrink-0 border-t bg-card px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
          <Button
            type="button"
            className="min-h-11 w-full"
            onClick={() => chooseDate(today)}
          >
            填写今天
          </Button>
        </div>
      )}
    </div>
  );
}
