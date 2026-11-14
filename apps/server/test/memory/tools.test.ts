/**
 * The memory tools against a scripted service: the off-record refusal
 * (bound session included — the gate is the session-free flag read),
 * receipt/ambiguous/already-remembered/nothing-matched copy, the empty
 * keyword's flip-through recall, and the off_record toggle itself, which
 * is never gated. Tool kinds are pinned: recall read-only, the rest
 * write-intent.
 */

import { describe, expect, it } from "vitest";
import { createMemoryTools } from "../../src/domains/memory/tools.ts";
import type {
  MemoryEntryView,
  MemoryOffRecordState,
  MemoryService,
  MemoryWriteResult,
} from "../../src/domains/memory/types.ts";
import type { TobyTool } from "../../src/infrastructure/model/agent.ts";

function makeService(
  overrides: {
    recall?: MemoryService["recall"];
    remember?: MemoryService["remember"];
    forget?: MemoryService["forget"];
    on?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const state = { on: overrides.on ?? false };
  const service: MemoryService = {
    list: async () => ({ entries: [] }),
    exportMarkdown: async () => "",
    recall:
      overrides.recall ??
      (async (keyword) => {
        calls.push(`recall(${keyword})`);
        return [];
      }),
    remember:
      overrides.remember ??
      (async (input) => {
        calls.push(`remember(${JSON.stringify(input)})`);
        return {
          kind: "receipt" as const,
          receipt: {
            action: "remembered" as const,
            type: input.type,
            after: `- ${input.text}`,
            created_at: "2026-11-14T08:00:00.000Z",
          },
        };
      }),
    forget:
      overrides.forget ??
      (async (keyword) => {
        calls.push(`forget(${keyword})`);
        return {
          kind: "receipt" as const,
          receipt: {
            action: "forgot" as const,
            type: "约定" as const,
            before: `- 关于${keyword}`,
            created_at: "2026-11-14T08:00:00.000Z",
          },
        };
      }),
    replaceExact: async () => {
      throw new Error("unused");
    },
    buildMemorySection: async () => "",
    observeSession: () => {},
    isOffRecord: () => state.on,
    getOffRecord: (): MemoryOffRecordState => ({
      sessionId: state.on ? "s1" : null,
      on: state.on,
    }),
    setOffRecord: (on) => {
      state.on = on;
    },
  };
  return { service, calls, state };
}

async function run(
  tool: TobyTool,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; details: unknown }> {
  const result = await tool.tool.execute("call-1", args as never);
  return {
    text: result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(""),
    isError: result.isError === true,
    details: result.details,
  };
}

describe("memory tools: recall", () => {
  it("is read-only, groups the hits by type, and quotes the empty answer", async () => {
    const { service } = makeService({
      recall: async () => [
        { type: "约定", text: "咖啡记「饮品」", expired: false },
        { type: "人物", name: "小王", text: "房东", expired: false },
      ],
    });
    const { recall } = createMemoryTools({ service });
    const result = await run(recall, { keyword: "咖啡" });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("约定:\n- 咖啡记「饮品」\n\n人物:\n- 小王: 房东");
    expect(result.details).toMatchObject({
      entries: [{ text: "咖啡记「饮品」" }, { name: "小王" }],
    });
  });

  it("an empty keyword flips through the whole book", async () => {
    const { service, calls } = makeService();
    const { recall } = createMemoryTools({ service });
    const result = await run(recall, {});
    expect(calls).toEqual(["recall()"]);
    expect(result.text).toBe("没有相关记忆");
  });

  it("an empty-string keyword is the same flip-through", async () => {
    const { service, calls } = makeService();
    const { recall } = createMemoryTools({ service });
    await run(recall, { keyword: "   " });
    expect(calls).toEqual(["recall(   )"]);
  });
});

describe("memory tools: remember", () => {
  it("is write-intent, answers 已记住 with the landed line, receipt in details", async () => {
    const { service, calls } = makeService();
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      type: "约定",
      text: "咖啡记「饮品」",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("已记住：- 咖啡记「饮品」");
    expect(result.details).toMatchObject({
      receipt: { action: "remembered", after: "- 咖啡记「饮品」" },
    });
    expect(calls).toHaveLength(1);
  });

  it("answers 已更新 with the new line when the receipt is an update", async () => {
    const { service } = makeService({
      remember: async () => ({
        kind: "receipt",
        receipt: {
          action: "updated",
          type: "约定",
          before: "- 咖啡记「拿铁」",
          after: "- 咖啡记「饮品」",
          created_at: "2026-11-14T08:00:00.000Z",
        },
      }),
    });
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      type: "约定",
      text: "咖啡记「饮品」",
      replaceKeyword: "咖啡",
    });
    expect(result.text).toBe("已更新：- 咖啡记「饮品」");
  });

  it("refuses while the flag is on — the bound session included", async () => {
    // on=true, getOffRecord reports the bound session s1: the flagged
    // conversation is the one being served, so the write must be refused.
    const { service, calls } = makeService({ on: true });
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, { type: "关于我", text: "不吃香菜" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("本通对话设置了不记忆，这次不记。");
    expect(calls).toEqual([]);
  });

  it("lists the candidates as an error result on ambiguity", async () => {
    const { service } = makeService({
      remember: async () => ({
        kind: "ambiguous",
        candidates: ["- 咖啡记「饮品」", "- 咖啡只喝美式"],
      }),
    });
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      type: "约定",
      text: "新约定",
      replaceKeyword: "咖啡",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("2 条记忆");
    expect(result.text).toContain("- 咖啡记「饮品」；- 咖啡只喝美式");
  });

  it("answers 已记得 for an exact duplicate, without an error", async () => {
    const { service } = makeService({
      remember: async () => ({
        kind: "already-remembered",
        line: "- 咖啡记「饮品」",
      }),
    });
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      type: "约定",
      text: "咖啡记「饮品」",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("已记得：- 咖啡记「饮品」");
  });
});

describe("memory tools: forget", () => {
  it("answers 已清理 with the removed line, receipt in details", async () => {
    const { service } = makeService();
    const { forget } = createMemoryTools({ service });
    const result = await run(forget, { keyword: "饮品" });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("已清理：- 关于饮品");
    expect(result.details).toMatchObject({
      receipt: { action: "forgot", before: "- 关于饮品" },
    });
  });

  it("refuses while the flag is on, like remember", async () => {
    const { service, calls } = makeService({ on: true });
    const { forget } = createMemoryTools({ service });
    const result = await run(forget, { keyword: "饮品" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("本通对话设置了不记忆，这次不记。");
    expect(calls).toEqual([]);
  });

  it("answers 没有相关记忆 when nothing matched", async () => {
    const { service } = makeService({
      forget: async (): Promise<MemoryWriteResult> => ({
        kind: "nothing-matched",
      }),
    });
    const { forget } = createMemoryTools({ service });
    const result = await run(forget, { keyword: "不存在的词" });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("没有相关记忆");
  });

  it("lists the candidates as an error result on ambiguity", async () => {
    const { service } = makeService({
      forget: async () => ({
        kind: "ambiguous",
        candidates: ["- 咖啡记「饮品」"],
      }),
    });
    const { forget } = createMemoryTools({ service });
    const result = await run(forget, { keyword: "咖啡" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("- 咖啡记「饮品」");
  });
});

describe("memory tools: off_record", () => {
  it("flips the flag and answers the copy for both directions", async () => {
    const { service, state } = makeService();
    const { offRecord } = createMemoryTools({ service });
    const on = await run(offRecord, { on: true });
    expect(on.text).toBe("好，这通不记了。");
    expect(state.on).toBe(true);
    expect(on.details).toEqual({ on: true });

    const off = await run(offRecord, { on: false });
    expect(off.text).toBe("好，恢复正常记忆。");
    expect(state.on).toBe(false);
  });

  it("is never gated by the flag itself", async () => {
    const { service } = makeService({ on: true });
    const { offRecord } = createMemoryTools({ service });
    const result = await run(offRecord, { on: false });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("好，恢复正常记忆。");
  });
});

describe("memory tools: kinds", () => {
  it("recall is read-only; the writes are write-intent", () => {
    const { service } = makeService();
    const tools = createMemoryTools({ service });
    expect(tools.recall.kind).toBe("read-only");
    expect(tools.remember.kind).toBe("write-intent");
    expect(tools.forget.kind).toBe("write-intent");
    expect(tools.offRecord.kind).toBe("write-intent");
  });

  it("the empty-recall view type stays the entry view (details contract)", async () => {
    const entries: readonly MemoryEntryView[] = [
      { type: "关于我", text: "不吃香菜", expired: false },
    ];
    const { service } = makeService({ recall: async () => entries });
    const { recall } = createMemoryTools({ service });
    const result = await run(recall, { keyword: "" });
    expect(
      (result.details as { entries: readonly MemoryEntryView[] }).entries,
    ).toBe(entries);
    expect(result.text).toContain("关于我:\n- 不吃香菜");
  });
});
