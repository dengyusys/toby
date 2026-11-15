/**
 * The schedule chat capability: the write-outcome mapping (receipt with
 * the domain's confirmation copy, the clarifying question), the two
 * read-only tools' rendering against a real schedule service, and the
 * toolset shape — exactly two read-only tools, the write tools absent
 * (they ride the schedule extraction agent only), and no inspect target
 * until the webs grow a schedule panel.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { createScheduleChatCapability } from "../../src/domains/schedule/chat-capability.ts";
import type { ScheduleService } from "../../src/domains/schedule/service.ts";
import type { ScheduleWriteReceipt } from "../../src/domains/schedule/types.ts";
import { createScheduleDomain } from "../../src/domains/schedule/plugin.ts";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-schedule-capability-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-15T08:00:00.000Z");

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;
let realService: ScheduleService;

async function buildDomain(): Promise<ScheduleService> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  const built = createScheduleDomain({ config, clock: () => nowMs });
  app = await createTestApp({
    config,
    domains: [(instance) => instance.register(built.plugin)],
  });
  return built.service;
}

beforeEach(async () => {
  realService = await buildDomain();
});

afterEach(async () => {
  await app.close();
});

/** A fake service for the outcome-mapping cases: write is overridable. */
function fakeService(write: ScheduleService["write"]): ScheduleService {
  const unused = (): never => {
    throw new Error("unused");
  };
  return {
    write,
    listItems: async () => ({ items: [] }),
    createItem: unused,
    updateItem: unused,
    deleteItem: unused,
    putEntry: unused,
    deleteEntry: unused,
    listEntries: unused,
    listViews: async () => ({ views: [] }),
    createView: unused,
    updateView: unused,
    deleteView: unused,
  };
}

const receipt: ScheduleWriteReceipt = {
  written: 3,
  entries: [],
  cleared: [],
  createdAt: "2026-11-15T08:00:00.000Z",
};

describe("schedule chat capability: outcome mapping", () => {
  it("maps a landed write to a receipt outcome carrying its own copy", async () => {
    const capability = createScheduleChatCapability(
      fakeService(async () => receipt),
    );
    const outcome = await capability.handleWrite(
      "今天没有吃早饭,没有吃中饭,但是吃了晚饭",
    );
    expect(outcome).toEqual({
      kind: "receipt",
      confirmText: "已记录 3 项。",
      receipt,
    });
  });

  it("the copy counts puts and clears separately", async () => {
    const capability = createScheduleChatCapability(
      fakeService(async () => ({
        ...receipt,
        written: 2,
        cleared: [{ id: 7, itemId: 1, title: "早饭", date: "2026-11-15" }],
      })),
    );
    const outcome = await capability.handleWrite("调整一下今天的记录");
    expect(outcome).toMatchObject({
      kind: "receipt",
      confirmText: "已记录 2 项、清除 1 项。",
    });
  });

  it("a clear-only turn says what it removed; a no-op turn says nothing landed", async () => {
    const clearOnly = createScheduleChatCapability(
      fakeService(async () => ({
        ...receipt,
        written: 0,
        cleared: [{ id: 7, itemId: 1, title: "早饭", date: "2026-11-15" }],
      })),
    );
    expect(await clearOnly.handleWrite("把今天早饭的记录删掉")).toMatchObject({
      kind: "receipt",
      confirmText: "已清除 1 项。",
    });
    const noOp = createScheduleChatCapability(
      fakeService(async () => ({ ...receipt, written: 0 })),
    );
    expect(await noOp.handleWrite("把今天早饭的记录删掉")).toMatchObject({
      kind: "receipt",
      confirmText: "没有产生改动。",
    });
  });

  it("maps a clarifying question to the question outcome", async () => {
    const capability = createScheduleChatCapability(
      fakeService(async () => ({
        question:
          "没有找到 id 为 99 的事项。请在界面里确认事项名称后再说一次。",
      })),
    );
    const outcome = await capability.handleWrite("晚饭没吃");
    expect(outcome).toEqual({
      kind: "question",
      text: "没有找到 id 为 99 的事项。请在界面里确认事项名称后再说一次。",
    });
  });
});

describe("schedule chat capability: toolset", () => {
  it("registers exactly the two read-only tools — writes stay with the intent", () => {
    const capability = createScheduleChatCapability(realService);
    // This array IS the none agent's schedule toolset: two read-only
    // entries, no put, no clear, and no item management anywhere.
    expect(capability.tools.map((entry) => entry.tool.name)).toEqual([
      "schedule_items",
      "schedule_entries",
    ]);
    for (const entry of capability.tools) {
      expect(entry.kind).toBe("read-only");
    }
  });

  it("maps nothing to an inspect target — no schedule panel exists yet", () => {
    const capability = createScheduleChatCapability(realService);
    expect(
      capability.inspectTarget("schedule_entries", {
        from: "2026-11-01",
        to: "2026-11-15",
      }),
    ).toBeUndefined();
    expect(capability.inspectTarget("schedule_items", {})).toBeUndefined();
    expect(capability.inspectTarget("anything_else", {})).toBeUndefined();
  });

  it("renders the item list with vocabularies and counts through the read tool", async () => {
    await realService.createItem({ title: "早饭", statuses: ["是", "否"] });
    const 锻炼 = await realService.createItem({
      title: "锻炼",
      statuses: ["完成", "部分", "没做"],
    });
    await realService.putEntry({
      itemId: 锻炼.id,
      date: "2026-11-14",
      status: "完成",
    });
    await realService.putEntry({
      itemId: 锻炼.id,
      date: "2026-11-15",
      status: "没做",
    });

    const capability = createScheduleChatCapability(realService);
    const tool = capability.tools.find(
      (entry) => entry.tool.name === "schedule_items",
    )!;
    const result = await tool.tool.execute("c1", {});
    const text = result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    expect(text).toContain("共 2 个事项:");
    expect(text).toContain("1. 早饭:是、否(已记录 0 天)");
    expect(text).toContain("2. 锻炼:完成、部分、没做(已记录 2 天)");
  });

  it("an empty board answers honestly", async () => {
    const capability = createScheduleChatCapability(realService);
    const tool = capability.tools.find(
      (entry) => entry.tool.name === "schedule_items",
    )!;
    const result = await tool.tool.execute("c1", {});
    expect(result.content[0]).toMatchObject({ text: "还没有任何事项。" });
  });

  it("renders the range list through the read tool, truncation included", async () => {
    const 早饭 = await realService.createItem({
      title: "早饭",
      statuses: ["是", "否"],
    });
    // 37 real days from late October through November: enough to cross
    // the 30-line display cap inside one query.
    const days: string[] = [];
    for (let day = 25; day <= 31; day += 1) {
      days.push(`2026-10-${String(day).padStart(2, "0")}`);
    }
    for (let day = 1; day <= 30; day += 1) {
      days.push(`2026-11-${String(day).padStart(2, "0")}`);
    }
    for (const date of days) {
      await realService.putEntry({ itemId: 早饭.id, date, status: "是" });
    }
    const capability = createScheduleChatCapability(realService);
    const tool = capability.tools.find(
      (entry) => entry.tool.name === "schedule_entries",
    )!;
    const result = await tool.tool.execute("c1", {
      from: "2026-10-25",
      to: "2026-11-30",
    });
    const text = result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    expect(text).toContain("2026-10-25 早饭:是");
    expect(text).toContain("(仅显示前 30 条,共 37 条)");

    // A 30-entry window renders whole — no truncation note.
    const whole = await tool.tool.execute("c2", {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    const wholeText = whole.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    expect(wholeText).toContain("2026-11-30 早饭:是");
    expect(wholeText).not.toContain("仅显示");

    const empty = await tool.tool.execute("c3", {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(empty.content[0]).toMatchObject({
      text: "2026-09-01 ~ 2026-09-30 没有任何记录。",
    });
  });

  it("a bad range becomes a model-visible failure, not a crash", async () => {
    const capability = createScheduleChatCapability(realService);
    const tool = capability.tools.find(
      (entry) => entry.tool.name === "schedule_entries",
    )!;
    await expect(
      tool.tool.execute("c1", { from: "2026-11-30", to: "2026-11-01" }),
    ).rejects.toThrow();
    await expect(
      tool.tool.execute("c2", { from: "2026-01-01", to: "2027-01-02" }),
    ).rejects.toThrow();
  });
});
