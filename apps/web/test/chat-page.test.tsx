/**
 * The unified chat page against a fetch stub: the item stream renders in
 * order (user bubble, transcript blocks, receipt card, notices, inspect
 * chips), a send lands as a persisted turn, and inspect chips open the
 * preview panel with the month report. No real network, no server.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPage } from "../src/features/chat/ChatPage.tsx";
import { AppLayout } from "../src/layouts/AppLayout.tsx";

const MONTHS = { months: ["2026-11", "2026-10"] };
const REPORT = {
  month: "2026-11",
  transactions: [
    {
      id: 1,
      date: "2026-11-05",
      type: "expense",
      category: "餐饮",
      account: "微信",
      amount: 3000,
      note: "午饭",
      created_at: "2026-11-05T08:00:00.000Z",
    },
  ],
  income_total: 0,
  expense_total: 3000,
  categories: [{ type: "expense", category: "餐饮", total: 3000 }],
};

const NOW = Date.now();
const SESSION_ID = "s-1";

/** One scripted send reply, defaulting to a ledger receipt turn. */
function receiptTurn(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "t-1",
    session_id: SESSION_ID,
    intent: "ledger",
    created_at: new Date(NOW).toISOString(),
    items: [
      { role: "user", content: "午饭 30", timestamp: NOW },
      {
        role: "assistant",
        content: [{ type: "text", text: "已记入 1 笔。" }],
        model: "synthetic",
        usage: {
          input: 0,
          output: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: NOW,
      },
      {
        type: "proposal_card",
        domain: "ledger",
        receipt: {
          created_at: new Date(NOW).toISOString(),
          written: 1,
          transaction_ids: [1],
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
        },
      },
    ],
    ...overrides,
  };
}

function agentTurn() {
  const CALL_ID = "c1";
  return {
    turn_id: "t-2",
    session_id: SESSION_ID,
    intent: "none",
    created_at: new Date(NOW).toISOString(),
    items: [
      { role: "user", content: "这个月吃饭花了多少", timestamp: NOW },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "查一下本月账单" },
          {
            type: "toolCall",
            id: CALL_ID,
            name: "ledger_month_report",
            arguments: { month: "2026-11" },
          },
        ],
        model: "faux-1",
        usage: {
          input: 1,
          output: 1,
          totalTokens: 2,
          cost: { input: 0, output: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: NOW,
      },
      {
        role: "toolResult",
        toolCallId: CALL_ID,
        toolName: "ledger_month_report",
        content: [{ type: "text", text: "2026-11 月:支出 ¥30.00" }],
        isError: false,
        timestamp: NOW,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "这个月吃饭花了 ¥30。" }],
        model: "faux-1",
        usage: {
          input: 1,
          output: 1,
          totalTokens: 2,
          cost: { input: 0, output: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: NOW,
      },
      {
        type: "inspect_link",
        source_tool_call_id: CALL_ID,
        target: "ledger:2026-11",
        label: "2026 年 11 月账单",
      },
    ],
  };
}

/** A one-shot assistant text reply, for markdown rendering cases. */
function assistantTextTurn(text: string) {
  return receiptTurn({
    intent: "none",
    items: [
      { role: "user", content: "随便问点", timestamp: NOW },
      {
        role: "assistant",
        content: [{ type: "text", text }],
        model: "synthetic",
        usage: {
          input: 0,
          output: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: NOW,
      },
    ],
  });
}

const calls: { url: string; init?: RequestInit }[] = [];
let sendReply: Record<string, unknown> = receiptTurn();
/** Turn history the messages endpoint serves: seeded, grown by sends. */
let historyTurns: Record<string, unknown>[] = [];

function routeFetch(): void {
  calls.length = 0;
  historyTurns = [sendReply];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      // The send reply echoes the sent text as its user item and
      // lands in the served history.
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      // Each landed turn gets a unique id, like the real server.
      const sendCounter = historyTurns.length + 1;
      const reply =
        url.endsWith("/api/chat/messages") &&
        typeof requestBody.text === "string"
          ? {
              ...sendReply,
              turn_id: `t-send-${sendCounter}`,
              items: [
                { role: "user", content: requestBody.text, timestamp: NOW },
                ...(sendReply.items as unknown[]).slice(1),
              ],
            }
          : sendReply;
      const body = url.endsWith("/api/chat/sessions")
        ? {
            sessions: [
              {
                session_id: SESSION_ID,
                created_at: new Date(NOW).toISOString(),
                excerpt: "午饭 30",
              },
            ],
          }
        : url.includes("/api/chat/sessions/")
          ? { turns: historyTurns }
          : url.endsWith("/api/ledger/months")
            ? MONTHS
            : url.startsWith("/api/ledger/transactions")
              ? REPORT
              : url.endsWith("/api/chat/messages")
                ? (historyTurns.push(reply), reply)
                : { status: "recorded" };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<ChatPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sendReply = receiptTurn();
});

it("restores the persisted turn and renders its items in order", async () => {
  routeFetch();
  renderApp();

  // User bubble, assistant text, receipt card — in stream order.
  expect(await screen.findByText("午饭 30")).toBeInTheDocument();
  expect(await screen.findByText("已记入 1 笔。")).toBeInTheDocument();
  expect(await screen.findByText("已记入")).toBeInTheDocument();
});

it("renders an agent turn: transcript, pairing, and the inspect chip opens the panel", async () => {
  sendReply = agentTurn();
  routeFetch();
  renderApp();

  expect(await screen.findByText("这个月吃饭花了多少")).toBeInTheDocument();
  expect(screen.getByText("思考过程")).toBeInTheDocument();
  expect(screen.getByText("调用工具:ledger_month_report")).toBeInTheDocument();
  expect(screen.getByText("工具结果:ledger_month_report")).toBeInTheDocument();

  // The inspect chip opens the preview panel with the month report.
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: /2026 年 11 月账单/ }));
  expect(await screen.findByText("分类小计")).toBeInTheDocument();
  expect(screen.getAllByText("¥30.00").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "关闭预览" })).toBeInTheDocument();

  // Restored history pushes nothing: no floating offer cards, no rail.
  expect(screen.queryByText("可以看")).not.toBeInTheDocument();
});

it("sending appends the turn optimistically and lands the persisted one", async () => {
  routeFetch();
  renderApp();
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("对话输入"), "晚饭 20");
  await user.click(screen.getByRole("button", { name: "发送" }));

  const sent = calls.find(({ url }) => url.endsWith("/api/chat/messages"));
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ text: "晚饭 20" });
  // The reply's items render (the optimistic user turn is replaced).
  await waitFor(() =>
    expect(screen.getAllByText("晚饭 20").length).toBeGreaterThanOrEqual(1),
  );
  // The seeded turn and the landed one both show their receipt cards.
  expect((await screen.findAllByText("已记入")).length).toBe(2);
});

it("pushes an offer card for a newly landed turn and opens the drawer from it", async () => {
  sendReply = agentTurn();
  routeFetch();
  renderApp();
  const user = userEvent.setup();

  // The restored agent turn shows its chip but pushes no card; the sent
  // one (same shape, new turn id) does.
  await screen.findByText("调用工具:ledger_month_report");
  expect(screen.queryByText("可以看")).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("对话输入"), "上个月呢");
  await user.click(screen.getByRole("button", { name: "发送" }));

  const card = await screen.findByRole("status");
  expect(card).toHaveTextContent("2026 年 11 月账单");
  // The card's own button — the stream carries same-named chips.
  await user.click(
    // Exact name: the close button's label also contains the title.
    within(card).getByRole("button", { name: "2026 年 11 月账单" }),
  );

  expect(await screen.findByText("分类小计")).toBeInTheDocument();
  // Opening served the card: it is gone.
  expect(screen.queryByText("可以看")).not.toBeInTheDocument();
});

it("renders assistant text as markdown: heading, list, code, table, link", async () => {
  sendReply = assistantTextTurn(
    [
      "## 本月餐饮小结",
      "",
      "- 餐饮 **¥1,240**,比上月多 ¥360",
      "",
      "常用命令是 `pnpm run check`,明细见 [账单说明](https://example.com/docs)。",
      "",
      "| 月份 | 支出 |",
      "| --- | --- |",
      "| 2026-11 | ¥1,240 |",
      "",
      "```ts",
      "const total = 1240;",
      "```",
    ].join("\n"),
  );
  routeFetch();
  renderApp();

  expect(
    await screen.findByRole("heading", { name: "本月餐饮小结" }),
  ).toBeInTheDocument();
  // listitem is not named-from-contents in ARIA, and getByText cannot see
  // across the <strong>, so assert on the li text contents directly.
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain(
    "餐饮 ¥1,240,比上月多 ¥360",
  );
  const link = screen.getByRole("link", { name: "账单说明" });
  expect(link).toHaveAttribute("href", "https://example.com/docs");
  expect(link).toHaveAttribute("target", "_blank");
  const table = screen.getByRole("table");
  expect(
    within(table).getByRole("cell", { name: "¥1,240" }),
  ).toBeInTheDocument();
  // Block code lands in a pre without inline-code chrome; inline code in code.
  expect(screen.getByText("const total = 1240;").closest("pre")).not.toBeNull();
  expect(screen.getByText("pnpm run check").closest("code")).not.toBeNull();
});

it("treats assistant text as untrusted: raw HTML and bad URLs never render", async () => {
  sendReply = assistantTextTurn(
    [
      "<script>alert(1)</script>",
      "",
      "[点我](javascript:alert(1))",
      "",
      "![追踪](https://tracker.example/pixel.png)",
      "",
      "正常段落照常显示。",
    ].join("\n"),
  );
  routeFetch();
  const { container } = renderApp();

  expect(await screen.findByText("正常段落照常显示。")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  // The layout ships its own logo img; only the untracked remote pixel counts.
  expect(container.querySelector('img[src*="tracker.example"]')).toBeNull();
  expect(container.querySelector('a[href*="javascript"]')).toBeNull();
});
