/**
 * Ledger page flow with fetch stubbed to the ledger endpoints: the
 * conversational recording panel (sentence → follow-up / proposal card →
 * commit / tacit approval) plus the month calendar and day panel. No real
 * network, no server.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerPage } from "../src/features/ledger/LedgerPage.tsx";
import { ChatPage } from "../src/features/chat/ChatPage.tsx";

const MONTHS = { months: ["2026-10", "2026-09"] };
const REPORT = {
  month: "2026-10",
  transactions: [
    {
      id: 1,
      date: "2026-10-20",
      type: "expense",
      category: "餐饮",
      account: "微信",
      amount: 2550,
      note: "午饭",
      created_at: "2026-10-20T08:00:00.000Z",
    },
    {
      id: 2,
      date: "2026-10-09",
      type: "income",
      category: "工资",
      account: "招行",
      amount: 500000,
      note: "",
      created_at: "2026-10-09T08:00:00.000Z",
    },
  ],
  income_total: 500000,
  expense_total: 2550,
  categories: [
    { type: "expense", category: "餐饮", total: 2550 },
    { type: "income", category: "工资", total: 500000 },
  ],
};
const FOLLOW_UP = { question: "这笔用的哪个账户?" };

// Fresh proposals get unique ids and future timestamps (the countdown must
// not reach zero inside a test); commit/cancel echo the id from the URL.
let proposalCounter = 0;

function proposalStub() {
  proposalCounter += 1;
  const now = Date.now();
  return {
    proposal_id: `lp-test-${proposalCounter}`,
    status: "pending",
    created_at: new Date(now).toISOString(),
    auto_write_at: new Date(now + 30_000).toISOString(),
    expires_at: new Date(now + 600_000).toISOString(),
    entries: [
      {
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        account: "微信",
        amount: 2550,
        note: "午饭",
      },
      {
        date: "2026-10-20",
        type: "income",
        category: "退款",
        account: "支付宝",
        amount: 1250,
        note: "",
      },
    ],
  };
}

function proposalIdFromUrl(url: string): string {
  return url.match(/proposals\/([^/?]+)/)?.[1] ?? "lp-unknown";
}

const calls: { url: string; init?: RequestInit }[] = [];

function routeFetch({
  textResults = ["follow-up"],
}: { textResults?: ("follow-up" | "proposal")[] } = {}): void {
  calls.length = 0;
  proposalCounter = 0;
  // One queued outcome per text proposal, in order; exhausted → follow-up.
  const queue = [...textResults];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      const body = url.endsWith("/api/ledger/months")
        ? MONTHS
        : init?.method === "DELETE"
          ? {
              transaction_id: Number(url.match(/transactions\/(\d+)/)?.[1]),
              status: "deleted",
              deleted_at: new Date().toISOString(),
            }
          : url.startsWith("/api/ledger/transactions")
            ? REPORT
            : url.endsWith("/commit")
              ? {
                  proposal_id: proposalIdFromUrl(url),
                  status: "committed",
                  written: 2,
                  transaction_ids: [3, 4],
                  committed_at: new Date().toISOString(),
                }
              : url.endsWith("/cancel")
                ? { proposal_id: proposalIdFromUrl(url), status: "cancelled" }
                : typeof requestBody.text === "string"
                  ? (queue.shift() ?? textResults.at(-1) ?? "follow-up") ===
                    "follow-up"
                    ? FOLLOW_UP
                    : proposalStub()
                  : proposalStub();
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LedgerPage />
    </QueryClientProvider>,
  );
}

function renderChatPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

async function sendSentence(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
) {
  await user.type(screen.getByLabelText("对话输入"), text);
  await user.click(screen.getByRole("button", { name: "发送" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("sends a sentence and shows the AI follow-up question in the stream", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderChatPage();

  // Empty conversation: the hero headline sits centered until the first send.
  expect(screen.getByText("有什么我能帮你的吗？")).toBeInTheDocument();

  await sendSentence(user, "午饭花了25");

  const sent = calls.find(({ url }) => url.endsWith("/api/ledger/proposals"));
  expect(JSON.parse(String(sent?.init?.body))).toEqual({
    text: "午饭花了25",
  });
  // The user's sentence bubbles on the right, the question replies below.
  expect(await screen.findByText("午饭花了25")).toBeInTheDocument();
  expect(await screen.findByText("这笔用的哪个账户?")).toBeInTheDocument();
  expect(screen.queryByText("有什么我能帮你的吗？")).not.toBeInTheDocument();
});

it("turns a sentence into a proposal card that commits and dismisses", async () => {
  routeFetch({ textResults: ["proposal"] });
  const user = userEvent.setup();
  renderChatPage();

  await sendSentence(user, "昨天午饭25,退款12.5");
  await screen.findByText("提案确认");

  // Countdown text and the multi-entry total row.
  expect(await screen.findByText(/后自动记入/)).toBeInTheDocument();
  expect(screen.getByText(/共 2 笔 · 合计 -¥13\.00/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认记入" }));
  expect(await screen.findByText("已确认写入")).toBeInTheDocument();
  expect(
    calls.some(({ url }) =>
      url.endsWith("/api/ledger/proposals/lp-test-1/commit"),
    ),
  ).toBe(true);

  // The card stays until dismissed.
  expect(screen.getByText("提案确认")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "知道了" }));
  expect(screen.queryByText("提案确认")).not.toBeInTheDocument();
});

it("cancelling the proposal shows the cancelled terminal state", async () => {
  routeFetch({ textResults: ["proposal"] });
  const user = userEvent.setup();
  renderChatPage();

  await sendSentence(user, "昨天午饭25");
  await screen.findByText(/后自动记入/);

  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(await screen.findByText("已取消,未写入")).toBeInTheDocument();
  expect(
    calls.some(({ url }) =>
      url.endsWith("/api/ledger/proposals/lp-test-1/cancel"),
    ),
  ).toBe(true);
});

it("sending the next sentence tacitly commits the pending proposal", async () => {
  routeFetch({ textResults: ["proposal"] });
  const user = userEvent.setup();
  renderChatPage();

  await sendSentence(user, "昨天午饭25");
  await screen.findByText("提案确认");

  await sendSentence(user, "今天打车8块");
  // The second card arrives pending; the first has been committed.
  expect(await screen.findAllByText("提案确认")).toHaveLength(2);
  expect(await screen.findByText("已确认写入")).toBeInTheDocument();
  expect(
    calls.some(({ url }) =>
      url.endsWith("/api/ledger/proposals/lp-test-1/commit"),
    ),
  ).toBe(true);
});

it("renders the month ledger with day subtotals and a day panel", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  // Wait on a data-driven marker: the month label alone can render from
  // the current-month fallback before the report arrives.
  expect((await screen.findAllByText("¥25.50")).length).toBeGreaterThan(0); // expense summary
  expect(screen.getByText("2026 年 10 月")).toBeInTheDocument();
  expect(screen.getAllByText("¥5000.00").length).toBeGreaterThan(0); // income

  // Cells carry per-day subtotals; picking a day opens its panel.
  expect(screen.getByText("支 25.50")).toBeInTheDocument();
  expect(screen.getByText("收 5000.00")).toBeInTheDocument();
  await user.click(
    screen.getByRole("gridcell", {
      name: "2026-10-09，支出 0.00，收入 5000.00",
    }),
  );
  expect(screen.getByText("工资")).toBeInTheDocument();
  expect(screen.getByText("+5000.00")).toBeInTheDocument();
  expect(screen.getByText("1 笔")).toBeInTheDocument();
  // Footer totals row: nested spans split the text, so match on content.
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === "SPAN" &&
        element.textContent === "支出 ¥0.00 · 收入 ¥5000.00",
    ),
  ).toBeInTheDocument();
});

it("pages to the previous month that has records", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByText("2026 年 10 月")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "上一月" }));

  expect(
    calls.some(({ url }) =>
      url.includes("/api/ledger/transactions?month=2026-09"),
    ),
  ).toBe(true);
});

it("deletes a day-panel transaction through the inline confirm", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  expect((await screen.findAllByText("¥25.50")).length).toBeGreaterThan(0);
  await user.click(
    screen.getByRole("gridcell", {
      name: "2026-10-20，支出 25.50，收入 0.00",
    }),
  );

  // The first click only arms the confirm; nothing is sent yet.
  await user.click(screen.getByRole("button", { name: "删除 餐饮 ¥25.50" }));
  expect(calls.some(({ init }) => init?.method === "DELETE")).toBe(false);

  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(
    calls.some(
      ({ url, init }) =>
        url.endsWith("/api/ledger/transactions/1") && init?.method === "DELETE",
    ),
  ).toBe(true);
  // The confirm controls fold back once the delete lands.
  expect(
    await screen.findByRole("button", { name: "删除 餐饮 ¥25.50" }),
  ).toBeInTheDocument();
});

it("folds a follow-up answer onto the sentence that was asked about", async () => {
  routeFetch({ textResults: ["follow-up", "proposal"] });
  const user = userEvent.setup();
  renderChatPage();

  await sendSentence(user, "晚饭吃了8块钱");
  expect(await screen.findByText("这笔用的哪个账户?")).toBeInTheDocument();

  // The fragment answer folds onto the original sentence before dispatch.
  await sendSentence(user, "微信");
  const sent = calls
    .filter(({ url }) => url.endsWith("/api/ledger/proposals"))
    .map(({ init }) => JSON.parse(String(init?.body)));
  expect(sent).toEqual([
    { text: "晚饭吃了8块钱" },
    { text: "晚饭吃了8块钱，微信" },
  ]);
  // The user bubble shows only the fragment as typed.
  expect(screen.getByText("微信")).toBeInTheDocument();
  expect(await screen.findByText("提案确认")).toBeInTheDocument();
});
