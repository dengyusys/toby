/**
 * The memory shapers as pure units: the agent's staleness window and text
 * caps, the classifier's window, and the HistoryTurn extraction (settled
 * turns only; notice text stands in as the reply when there is no
 * assistant text). These were previously observable only through the
 * heavyweight HTTP flow.
 */

import { describe, expect, it } from "vitest";
import {
  agentHistoryOf,
  classifierHistoryOf,
  historyTurnsOf,
  HISTORY_FETCH_LIMIT,
} from "../../src/domains/chat/history.ts";
import type { ChatTurnView } from "../../src/domains/chat/types.ts";

const BASE_MS = Date.parse("2026-11-05T08:00:00.000Z");

function turn(
  id: string,
  createdAt: string,
  items: Record<string, unknown>[],
): ChatTurnView {
  return {
    turn_id: id,
    session_id: "s1",
    intent: "none",
    created_at: createdAt,
    items: items as unknown as ChatTurnView["items"],
  };
}

function userText(text: string): Record<string, unknown> {
  return { role: "user", content: text, timestamp: BASE_MS };
}

function assistantText(text: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: BASE_MS,
  };
}

function notice(text: string): Record<string, unknown> {
  return { type: "notice", text };
}

describe("historyTurnsOf", () => {
  it("keeps settled turns only — an unanswered turn never folds onto itself", () => {
    const settled = turn("t1", new Date(BASE_MS).toISOString(), [
      userText("你好"),
      assistantText("在的"),
    ]);
    const unsettled = turn("t2", new Date(BASE_MS + 1000).toISOString(), [
      userText("今天呢"),
    ]);
    const turns = historyTurnsOf([settled, unsettled]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ user: "你好", reply: "在的" });
  });

  it("extracts the reply from a notice when no assistant text exists", () => {
    const turns = historyTurnsOf([
      turn("t1", new Date(BASE_MS).toISOString(), [
        userText("记一笔"),
        assistantText("这笔是支出还是收入?"),
        notice("分类器开小差了"),
      ]),
    ]);
    // The notice is the last visible text, so the classifier sees it.
    expect(turns[0]!.reply).toBe("分类器开小差了");
    // The agent replays assistant text only — no notices.
    expect(turns[0]!.assistant_text).toBe("这笔是支出还是收入?");
  });

  it("fetches one turn more than the replay window", () => {
    // The just-persisted turn sits in the fetched page and is filtered
    // out, so the window needs the fetch to over-read by one.
    expect(HISTORY_FETCH_LIMIT).toBe(5);
  });
});

describe("classifierHistoryOf", () => {
  it("keeps the last three exchanges", () => {
    const turns = [1, 2, 3, 4, 5].map((i) => ({
      user: `第${i}句`,
      reply: `第${i}答`,
      assistant_text: `第${i}答`,
      created_at: new Date(BASE_MS + i * 1000).toISOString(),
    }));
    const view = classifierHistoryOf(turns);
    expect(view.map((entry) => entry.user)).toEqual([
      "第3句",
      "第4句",
      "第5句",
    ]);
  });
});

describe("agentHistoryOf", () => {
  const settled = {
    user: "这个月花了多少",
    reply: "花了 ¥120。",
    assistant_text: "花了 ¥120。",
    created_at: new Date(BASE_MS).toISOString(),
  };

  it("replays a fresh turn", () => {
    const view = agentHistoryOf([settled], BASE_MS + 1000);
    expect(view).toEqual([
      { role: "user", text: "这个月花了多少", timestamp: BASE_MS },
      { role: "assistant", text: "花了 ¥120。", timestamp: BASE_MS },
    ]);
  });

  it("drops turns past the six-hour staleness window", () => {
    const justInside = agentHistoryOf([settled], BASE_MS + 6 * 60 * 60 * 1000);
    expect(justInside).toHaveLength(2);
    const justOutside = agentHistoryOf(
      [settled],
      BASE_MS + 6 * 60 * 60 * 1000 + 1,
    );
    expect(justOutside).toEqual([]);
  });

  it("caps each replayed text at 500 characters", () => {
    const long = {
      user: "长".repeat(600),
      reply: "",
      assistant_text: "",
      created_at: new Date(BASE_MS).toISOString(),
    };
    const [entry] = agentHistoryOf([long], BASE_MS);
    expect(entry!.text).toHaveLength(501); // 500 chars + the ellipsis
    expect(entry!.text.endsWith("…")).toBe(true);
  });
});
