/**
 * The memory shapers as pure units: the agent's conversation window and
 * size cap, the classifier's window, and the HistoryTurn extraction
 * (settled turns only; notice text stands in as the reply when there is
 * no assistant text). These were previously observable only through the
 * heavyweight HTTP flow.
 */

import { describe, expect, it } from "vitest";
import {
  agentHistoryOf,
  AGENT_HISTORY_FETCH_LIMIT,
  classifierHistoryOf,
  CLASSIFIER_FETCH_LIMIT,
  historyTurnsOf,
} from "../../src/domains/chat/history.ts";
import type { ChatTurnView } from "../../src/domains/chat/types.ts";

const BASE_MS = Date.parse("2026-11-05T08:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

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

  it("the fetch limits cover their windows plus the unreadable tail", () => {
    // Classifier: the window plus the just-persisted turn and one
    // interrupted turn, both reply-less and filtered out below the window.
    expect(CLASSIFIER_FETCH_LIMIT).toBe(5);
    // Agent: the bound on database work, far above a day's conversation.
    expect(AGENT_HISTORY_FETCH_LIMIT).toBe(200);
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

  it("replays a fresh exchange verbatim, with no per-text cap", () => {
    const long = {
      user: "长".repeat(600),
      reply: "",
      assistant_text: "",
      created_at: new Date(BASE_MS).toISOString(),
    };
    const view = agentHistoryOf([long], BASE_MS, 24 * HOUR_MS);
    expect(view).toEqual([
      { role: "user", text: "长".repeat(600), timestamp: BASE_MS },
    ]);
  });

  it("keeps a turn exactly at the window edge, drops one past it", () => {
    const justInside = agentHistoryOf(
      [settled],
      BASE_MS + 6 * HOUR_MS,
      6 * HOUR_MS,
    );
    expect(justInside).toHaveLength(2);
    const justOutside = agentHistoryOf(
      [settled],
      BASE_MS + 6 * HOUR_MS + 1,
      6 * HOUR_MS,
    );
    expect(justOutside).toEqual([]);
  });

  it("replays an exchange hours old when the window allows it", () => {
    // The behavior this window exists for: this morning's thread is still
    // this evening's context.
    const view = agentHistoryOf(
      [settled],
      BASE_MS + 10 * HOUR_MS,
      24 * HOUR_MS,
    );
    expect(view).toHaveLength(2);
  });

  it("drops the oldest exchanges first once the size cap is hit", () => {
    const exchange = (id: string, hoursAgo: number) => ({
      user: `${id}${"字".repeat(12_000)}`,
      reply: "",
      assistant_text: "",
      created_at: new Date(BASE_MS - hoursAgo * HOUR_MS).toISOString(),
    });
    // Each exchange is 12k+ chars; three exceed the 30k cap, so only the
    // newest two ride.
    const view = agentHistoryOf(
      [
        exchange("旧1", 3),
        exchange("旧2", 2),
        exchange("新1", 1),
        exchange("新2", 0),
      ],
      BASE_MS,
      24 * HOUR_MS,
    );
    expect(view.map((entry) => entry.text.slice(0, 2))).toEqual(["新1", "新2"]);
  });

  it("always keeps the newest exchange whole, even past the cap", () => {
    const oversized = {
      user: "巨".repeat(40_000),
      reply: "",
      assistant_text: "",
      created_at: new Date(BASE_MS).toISOString(),
    };
    const view = agentHistoryOf([oversized], BASE_MS, 24 * HOUR_MS);
    expect(view).toEqual([
      { role: "user", text: "巨".repeat(40_000), timestamp: BASE_MS },
    ]);
  });
});
