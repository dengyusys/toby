/**
 * The memory tools against a scripted service: the off-record refusal
 * (bound session included — the gate is the session-free flag read),
 * receipt/ambiguous/already-remembered/nothing-matched copy, the section
 * parameter riding through to the service, and the off_record toggle
 * itself, which is never gated. All three tools are write-intent.
 */

import { describe, expect, it } from "vitest";
import { createMemoryTools } from "../../src/domains/memory/tools.ts";
import type {
  MemoryOffRecordState,
  MemoryService,
  MemoryWriteResult,
} from "../../src/domains/memory/types.ts";
import type { TobyTool } from "../../src/infrastructure/model/agent.ts";

function makeService(
  overrides: {
    remember?: MemoryService["remember"];
    forget?: MemoryService["forget"];
    on?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const state = { on: overrides.on ?? false };
  const service: MemoryService = {
    readFile: async () => "",
    remember:
      overrides.remember ??
      (async (input) => {
        calls.push(`remember(${JSON.stringify(input)})`);
        return {
          kind: "receipt" as const,
          receipt: {
            action: "remembered" as const,
            section: input.section,
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
            section: "约定" as const,
            before: `- 关于${keyword}`,
            created_at: "2026-11-14T08:00:00.000Z",
          },
        };
      }),
    resetMemory: async () => ({ reset_at: "2026-11-14T08:00:00.000Z" }),
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

describe("memory tools: remember", () => {
  it("is write-intent, answers 已记住 with the landed line, receipt in details", async () => {
    const { service, calls } = makeService();
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      section: "约定",
      text: "咖啡记「饮品」",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("已记住：- 咖啡记「饮品」");
    expect(result.details).toMatchObject({
      receipt: { action: "remembered", after: "- 咖啡记「饮品」" },
    });
    // The section rides through to the service untouched.
    expect(calls).toEqual([
      `remember(${JSON.stringify({ section: "约定", text: "咖啡记「饮品」" })})`,
    ]);
  });

  it("answers 已更新 with the new line when the receipt is an update", async () => {
    const { service } = makeService({
      remember: async () => ({
        kind: "receipt",
        receipt: {
          action: "updated",
          section: "约定",
          before: "- 咖啡记「拿铁」",
          after: "- 咖啡记「饮品」",
          created_at: "2026-11-14T08:00:00.000Z",
        },
      }),
    });
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      section: "工作",
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
    const result = await run(remember, { section: "关于我", text: "不吃香菜" });
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
      section: "约定",
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
      section: "约定",
      text: "咖啡记「饮品」",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("已记得：- 咖啡记「饮品」");
  });

  it("the prompt guidance carries the section-choice rules, and no tool names", () => {
    const { service } = makeService();
    const tools = createMemoryTools({ service });
    expect(tools.remember.promptGuidelines.join("\n")).toContain(
      "优先用记忆里已有的",
    );
    expect(tools.remember.promptGuidelines.join("\n")).toContain(
      "用户明确指定了小节",
    );
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
  it("every memory tool is write-intent", () => {
    const { service } = makeService();
    const tools = createMemoryTools({ service });
    expect(tools.remember.kind).toBe("write-intent");
    expect(tools.forget.kind).toBe("write-intent");
    expect(tools.offRecord.kind).toBe("write-intent");
    expect(Object.keys(tools).sort()).toEqual([
      "forget",
      "offRecord",
      "remember",
    ]);
  });

  it("the until parameter rides through to the service", async () => {
    const { service, calls } = makeService();
    const { remember } = createMemoryTools({ service });
    const result = await run(remember, {
      section: "约定",
      text: "出差餐饮记「差旅」",
      until: "2026-11-30",
    });
    expect(result.isError).toBe(false);
    expect(calls).toEqual([
      `remember(${JSON.stringify({
        section: "约定",
        text: "出差餐饮记「差旅」",
        until: "2026-11-30",
      })})`,
    ]);
  });
});
