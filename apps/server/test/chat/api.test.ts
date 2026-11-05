/**
 * Chat domain HTTP contract, driven through fastify inject against the
 * fully assembled domain (real sqlite chat.db + real sqlite ledger.db in
 * a fresh temporary directory per case, injected clock, fake classifier
 * and fake ledger extractor). Pins: the item-stream turn shapes for
 * every route (ledger receipt / follow-up / none-agent transcript /
 * on-the-way notices / unconfigured notices), user-message-first
 * persistence, paging, session lifecycle, rate limiting, and outcome
 * recording.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveConfig } from "../../src/infrastructure/config/config.ts";
import { chatPlugin } from "../../src/domains/chat/chat.plugin.ts";
import type {
  ChatLedgerPort,
  IntentClassifier,
} from "../../src/domains/chat/types.ts";
import type {
  LedgerDraft,
  LedgerExtractor,
} from "../../src/domains/ledger/extraction.ts";
import { createLedgerDomain } from "../../src/domains/ledger/ledger.plugin.ts";
import type { TobyAgentFactory } from "../../src/infrastructure/model/agent.ts";
import type { Message } from "@earendil-works/pi-ai";
import { createTestApp } from "../app-fixture.ts";

const baseDir = mkdtempSync(path.join(tmpdir(), "toby-chat-api-"));

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const BASE_MS = Date.parse("2026-11-05T08:00:00.000Z");

let app: FastifyInstance;
let nowMs: number;
let caseCounter = 0;

/** Scripted classification replies, one per send, in order. */
let classifications: {
  intent: "ledger" | "schedule" | "memory" | "notes" | "todo" | "none";
  sentence: string;
}[] = [];
const classifier: IntentClassifier = {
  classify: async (text, history) => {
    classifierCalls.push({ text, history: [...history] });
    return classifications.shift() ?? { intent: "none", sentence: text };
  },
};
const classifierCalls: { text: string; history: unknown[] }[] = [];

let extractorDraft: () => LedgerDraft = () => ({
  question: "这笔是支出还是收入?",
});

const extractor: LedgerExtractor = {
  extract: async () => extractorDraft(),
};

type DomainMount = (app: FastifyInstance) => PromiseLike<unknown> | void;

/** Chat alone (no ledger port, no AI unless overridden: notices take over). */
async function buildChatOnlyApp(
  options: {
    classifierOverride?: IntentClassifier;
    rateLimit?: { limit?: number; windowMs?: number };
  } = {},
): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  app = await createTestApp({
    config,
    domains: [
      (instance) =>
        instance.register(
          chatPlugin({
            config,
            clock: () => nowMs,
            ...(options.classifierOverride
              ? { classifier: options.classifierOverride }
              : {}),
            ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
          }),
        ),
    ],
  });
}

/** Chat + a real ledger domain, wired exactly like the composition root. */
async function buildLedgerBackedApp(): Promise<void> {
  caseCounter += 1;
  nowMs = BASE_MS;
  const config = resolveConfig({
    env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
  });
  const ledgerDomain = createLedgerDomain({
    config,
    clock: () => nowMs,
    extractor,
  });
  const ledgerPort: ChatLedgerPort = {
    recordFromText: (text) => ledgerDomain.service.createProposal({ text }),
    months: () => ledgerDomain.service.months(),
    monthReport: (month) => ledgerDomain.service.monthReport(month),
  };
  const mounts: DomainMount[] = [
    (instance) => instance.register(ledgerDomain.plugin),
    (instance) =>
      instance.register(
        chatPlugin({
          config,
          clock: () => nowMs,
          classifier,
          ledger: ledgerPort,
        }),
      ),
  ];
  app = await createTestApp({ config, domains: mounts });
}

beforeEach(async () => {
  classifications = [];
  classifierCalls.length = 0;
  extractorDraft = () => ({ question: "这笔是支出还是收入?" });
});

afterEach(async () => {
  await app.close();
});

function inject(
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
}

describe("chat api: send and the item stream", () => {
  it("routes a ledger sentence into an immediate receipt card", async () => {
    await buildLedgerBackedApp();
    extractorDraft = () => ({
      entries: [
        {
          date: "2026-11-05",
          type: "expense",
          category: "餐饮",
          account: "微信",
          amount: 3000,
          note: "午饭",
        },
      ],
    });
    classifications = [{ intent: "ledger", sentence: "午饭 30" }];

    const response = await inject("POST", "/api/chat/messages", {
      text: "午饭 30",
    });
    expect(response.statusCode).toBe(200);
    const turn = response.json();
    expect(turn.intent).toBe("ledger");
    expect(turn.items).toHaveLength(3);
    // ① the user's words as a verbatim user message…
    expect(turn.items[0]).toMatchObject({ role: "user", content: "午饭 30" });
    // ② a short assistant confirmation…
    expect(turn.items[1].role).toBe("assistant");
    // ③ …and the born-confirmed receipt card.
    expect(turn.items[2]).toMatchObject({
      type: "proposal_card",
      domain: "ledger",
      receipt: {
        status: "committed",
        written: 1,
        revert_until: new Date(BASE_MS + 600_000).toISOString(),
      },
    });
    // The write has landed through the port.
    const months = await inject("GET", "/api/ledger/months");
    expect(months.json()).toEqual({ months: ["2026-11"] });
  });

  it("a ledger follow-up question becomes an assistant message item", async () => {
    await buildLedgerBackedApp();
    extractorDraft = () => ({ question: "这笔用的哪个账户?" });
    classifications = [{ intent: "ledger", sentence: "记一笔 8 块" }];

    const response = await inject("POST", "/api/chat/messages", {
      text: "记一笔 8 块",
    });
    const turn = response.json();
    expect(turn.intent).toBe("ledger");
    expect(turn.items[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "这笔用的哪个账户?" }],
    });
    // Nothing was written; no card item exists.
    expect(
      turn.items.some(
        (item: { type?: string }) => item.type === "proposal_card",
      ),
    ).toBe(false);
  });

  it("not-yet-landed intents answer an on-the-way notice", async () => {
    await buildLedgerBackedApp();
    for (const intent of ["schedule", "memory", "notes", "todo"] as const) {
      classifications = [{ intent, sentence: "whatever" }];
      const response = await inject("POST", "/api/chat/messages", {
        text: "随手记一下这件事",
      });
      const turn = response.json();
      expect(turn.intent).toBe(intent);
      const notice = turn.items.at(-1);
      expect(notice).toMatchObject({ type: "notice" });
      expect(typeof notice.text).toBe("string");
      expect(notice.text).toContain("在路上");
    }
  });

  it("the classifier sees prior exchanges, not the just-persisted one", async () => {
    await buildLedgerBackedApp();
    classifications = [
      { intent: "none", sentence: "你好" },
      { intent: "none", sentence: "今天几号" },
    ];
    await inject("POST", "/api/chat/messages", { text: "你好" });
    await inject("POST", "/api/chat/messages", { text: "今天几号" });

    expect(classifierCalls).toHaveLength(2);
    // The second classify happens after its own turn was persisted; the
    // history must exclude it (its user text arrives as `text` instead).
    const second = classifierCalls[1]!;
    expect(second.text).toBe("今天几号");
    const priorTurns = second.history as { user?: string }[];
    expect(priorTurns.some((turn) => turn.user === "今天几号")).toBe(false);
    expect(priorTurns.some((turn) => turn.user === "你好")).toBe(true);
  });

  it("the none-agent turn replays its transcript as items with inspect links", async () => {
    // A fake agent factory whose run returns a verbatim pi-ai transcript:
    // system + user + assistant(toolCall) + toolResult + assistant(text).
    const runMessages: Message[] = [
      { role: "system", content: "你是 Toby", timestamp: 1 },
      { role: "user", content: "这个月吃饭花了多少", timestamp: 2 },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "ledger_month_report",
            arguments: { month: "2026-11" },
          },
        ],
        model: "faux-1",
        api: "faux",
        provider: "faux",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "ledger_month_report",
        content: [{ type: "text", text: "2026-11 月:支出 ¥120.00" }],
        isError: false,
        timestamp: 4,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "这个月吃饭花了 ¥120。" }],
        model: "faux-1",
        api: "faux",
        provider: "faux",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 5,
      },
    ];
    const agentFactory: TobyAgentFactory = () => ({
      run: async () => ({
        text: "这个月吃饭花了 ¥120。",
        turns: 2,
        turnCapped: false,
        stopReason: "stop" as const,
        usage: {
          input: 2,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 4,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        messages: runMessages,
      }),
    });
    const ledgerReads: string[] = [];
    const ledgerPort: ChatLedgerPort = {
      recordFromText: async () => {
        throw new Error("not on this path");
      },
      months: async () => {
        ledgerReads.push("months");
        return { months: ["2026-11"] };
      },
      monthReport: async (month) => {
        ledgerReads.push(`report:${month}`);
        return {
          month,
          income_total: 0,
          expense_total: 12000,
          categories: [{ type: "expense", category: "餐饮", total: 12000 }],
          transactions: [
            {
              date: "2026-11-05",
              type: "expense",
              category: "餐饮",
              account: "微信",
              amount: 12000,
              note: "",
            },
          ],
        };
      },
    };
    await app.close();
    caseCounter += 1;
    nowMs = BASE_MS;
    const config = resolveConfig({
      env: { TOBY_DATA_ROOT: path.join(baseDir, `case-${caseCounter}`) },
    });
    app = await createTestApp({
      config,
      domains: [
        (instance) =>
          instance.register(
            chatPlugin({
              config,
              clock: () => nowMs,
              classifier,
              agentFactory,
              ledger: ledgerPort,
            }),
          ),
      ],
    });
    classifications = [{ intent: "none", sentence: "这个月吃饭花了多少" }];

    const response = await inject("POST", "/api/chat/messages", {
      text: "这个月吃饭花了多少",
    });
    expect(response.statusCode).toBe(200);
    const turn = response.json();
    expect(turn.intent).toBe("none");

    // The verbatim transcript rides as message items (system and the
    // agent's own user prompt stay out — this turn already shows them).
    const roles = turn.items.map((item: { role?: string }) => item.role);
    expect(roles).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      undefined, // the inspect link
    ]);
    expect(turn.items[1].content[0]).toMatchObject({
      type: "toolCall",
      id: "c1",
      name: "ledger_month_report",
    });
    expect(turn.items[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "c1",
      toolName: "ledger_month_report",
    });
    // The deterministic inspect link points at the panel target.
    expect(turn.items.at(-1)).toMatchObject({
      type: "inspect_link",
      source_tool_call_id: "c1",
      target: "ledger:2026-11",
      label: "2026 年 11 月账单",
    });
  });

  it("classification failure settles as an honest notice, never a 5xx", async () => {
    await buildLedgerBackedApp();
    const failing: IntentClassifier = {
      classify: async () => {
        throw new Error("model down");
      },
    };
    await app.close();
    await buildChatOnlyApp({ classifierOverride: failing });

    const response = await inject("POST", "/api/chat/messages", {
      text: "你好",
    });
    expect(response.statusCode).toBe(200);
    const turn = response.json();
    expect(turn.intent).toBe("none");
    // The user's words persisted even though the AI failed.
    expect(turn.items[0]).toMatchObject({ role: "user", content: "你好" });
    expect(turn.items.at(-1)).toMatchObject({ type: "notice" });
  });

  it("absent AI answers the unconfigured notice instead of 501", async () => {
    await buildChatOnlyApp();
    const response = await inject("POST", "/api/chat/messages", {
      text: "你好",
    });
    expect(response.statusCode).toBe(200);
    const notice = response.json().items.at(-1);
    expect(notice).toMatchObject({ type: "notice" });
    expect(notice.text).toContain("AI is not configured");
  });

  it("empty text is 400; the body envelope is strict", async () => {
    await buildChatOnlyApp();
    const empty = await inject("POST", "/api/chat/messages", { text: "  " });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().errorCode).toBe("INVALID_TEXT");
    const malformed = await inject("POST", "/api/chat/messages", {
      text: "x",
      extra: 1,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().errorCode).toBe("BAD_REQUEST");
  });

  it("rate-limits sends per IP inside the window", async () => {
    // A tiny limit keeps the test fast.
    await buildChatOnlyApp({ rateLimit: { limit: 2, windowMs: 60_000 } });

    for (let i = 0; i < 2; i += 1) {
      const ok = await inject("POST", "/api/chat/messages", {
        text: `第${i + 1}句`,
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await inject("POST", "/api/chat/messages", {
      text: "第三句",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().errorCode).toBe("RATE_LIMITED");
    // A new window reopens the budget.
    nowMs += 60_001;
    const reopened = await inject("POST", "/api/chat/messages", {
      text: "新窗口",
    });
    expect(reopened.statusCode).toBe(200);
  });
});

describe("chat api: sessions and paging", () => {
  it("lists sessions with derived excerpts, pages turns by cursor", async () => {
    await buildChatOnlyApp();
    classifications = [
      { intent: "none", sentence: "第一句" },
      { intent: "none", sentence: "第二句" },
      { intent: "none", sentence: "第三句" },
    ];
    for (const text of ["第一句", "第二句", "第三句"]) {
      const response = await inject("POST", "/api/chat/messages", { text });
      expect(response.statusCode).toBe(200);
    }

    const sessions = await inject("GET", "/api/chat/sessions");
    const sessionList = sessions.json().sessions;
    expect(sessionList).toHaveLength(1);
    expect(sessionList[0].excerpt).toBe("第三句");

    const sessionId = sessionList[0].session_id;
    const firstPage = await inject(
      "GET",
      `/api/chat/sessions/${sessionId}/messages?limit=2`,
    );
    const page = firstPage.json();
    expect(
      page.turns.map((t: { items: unknown[] }) => t.items[0]),
    ).toHaveLength(2);
    expect(page.turns.map((turn: { intent: string }) => turn.intent)).toEqual([
      "none",
      "none",
    ]);
    expect(typeof page.next_before).toBe("string");

    const secondPage = await inject(
      "GET",
      `/api/chat/sessions/${sessionId}/messages?limit=2&before=${page.next_before}`,
    );
    const older = secondPage.json();
    expect(older.turns).toHaveLength(1);
    expect(older.next_before).toBeUndefined();
    // Oldest → newest inside each window.
    expect(older.turns[0].items[0].content).toBe("第一句");
    expect(page.turns[0].items[0].content).toBe("第二句");
    expect(page.turns[1].items[0].content).toBe("第三句");
  });

  it("unknown sessions and turns answer 404; deletion cascades", async () => {
    await buildChatOnlyApp();
    const missing = await inject("GET", "/api/chat/sessions/nope/messages");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe("SESSION_NOT_FOUND");

    const outcome = await inject("POST", "/api/chat/messages/nope/outcome", {
      outcome: "reverted",
    });
    expect(outcome.statusCode).toBe(404);
    expect(outcome.json().errorCode).toBe("TURN_NOT_FOUND");

    const created = await inject("POST", "/api/chat/sessions");
    expect(created.statusCode).toBe(200);
    expect(created.json().excerpt).toBe("(新对话)");

    const sent = await inject("POST", "/api/chat/messages", { text: "你好" });
    const sessionId = sent.json().session_id;
    const deleted = await inject("DELETE", `/api/chat/sessions/${sessionId}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ status: "deleted" });
    const gone = await inject(
      "GET",
      `/api/chat/sessions/${sessionId}/messages`,
    );
    expect(gone.statusCode).toBe(404);
    const repeat = await inject("DELETE", `/api/chat/sessions/${sessionId}`);
    expect(repeat.statusCode).toBe(404);
  });

  it("records a card outcome as display metadata", async () => {
    await buildChatOnlyApp();
    const sent = await inject("POST", "/api/chat/messages", { text: "你好" });
    const turnId = sent.json().turn_id;
    const sessionId = sent.json().session_id;

    const reported = await inject(
      "POST",
      `/api/chat/messages/${turnId}/outcome`,
      { outcome: "reverted" },
    );
    expect(reported.statusCode).toBe(200);
    expect(reported.json()).toEqual({ status: "recorded" });

    const page = await inject(
      "GET",
      `/api/chat/sessions/${sessionId}/messages`,
    );
    expect(page.json().turns[0].card_outcome).toBe("reverted");
  });

  it("the send endpoint validates the limit parameter", async () => {
    await buildChatOnlyApp();
    const sent = await inject("POST", "/api/chat/messages", { text: "你好" });
    const sessionId = sent.json().session_id;
    for (const limit of ["0", "-1", "abc", "101"]) {
      const response = await inject(
        "GET",
        `/api/chat/sessions/${sessionId}/messages?limit=${limit}`,
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe("INVALID_TEXT");
    }
  });
});
