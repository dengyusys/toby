/**
 * Ledger page flow with fetch stubbed to the ledger endpoints: month
 * calendar + day panel rendering, structured proposal creation, the
 * countdown card with its terminal states, and the sentence follow-up.
 * No real network, no server.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerPage } from "../src/features/ledger/LedgerPage.tsx";

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
// Future timestamps: the countdown must not reach zero inside a test.
const NOW_MS = Date.now();
const PROPOSAL = {
  proposal_id: "lp-test-1",
  status: "pending",
  created_at: new Date(NOW_MS).toISOString(),
  auto_write_at: new Date(NOW_MS + 30_000).toISOString(),
  expires_at: new Date(NOW_MS + 600_000).toISOString(),
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
const COMMITTED = {
  proposal_id: "lp-test-1",
  status: "committed",
  written: 2,
  transaction_ids: [3, 4],
  committed_at: new Date(NOW_MS).toISOString(),
};
const FOLLOW_UP = { question: "这笔用的哪个账户?" };

const calls: { url: string; init?: RequestInit }[] = [];

function routeFetch(): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      const body = url.endsWith("/api/ledger/months")
        ? MONTHS
        : url.startsWith("/api/ledger/transactions")
          ? REPORT
          : url.endsWith("/commit")
            ? COMMITTED
            : url.endsWith("/cancel")
              ? { proposal_id: "lp-test-1", status: "cancelled" }
              : typeof requestBody.text === "string"
                ? FOLLOW_UP
                : PROPOSAL;
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("submits a sentence and shows the AI follow-up question", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("2026 年 10 月");

  await user.type(screen.getByLabelText("一句话记账"), "午饭花了25");
  await user.click(screen.getByRole("button", { name: "解析" }));

  const sent = calls.find(({ url }) => url.endsWith("/api/ledger/proposals"));
  expect(JSON.parse(String(sent?.init?.body))).toEqual({
    text: "午饭花了25",
  });
  expect(
    await screen.findByText("补充一下:这笔用的哪个账户?"),
  ).toBeInTheDocument();
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

it("creates a proposal from the form; the card counts down, totals, and lands in a terminal state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("2026 年 10 月");

  await user.type(screen.getByLabelText("分类"), "餐饮");
  await user.type(screen.getByLabelText("账户"), "微信");
  await user.type(screen.getByLabelText("金额"), "25.5");
  await user.type(screen.getByLabelText("备注"), "午饭");
  await user.click(screen.getByRole("button", { name: "生成提案" }));

  const created = calls.find(({ url }) =>
    url.endsWith("/api/ledger/proposals"),
  );
  expect(created?.init?.method).toBe("POST");
  expect(JSON.parse(String(created?.init?.body))).toEqual({
    entry: {
      date: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
      type: "expense",
      category: "餐饮",
      account: "微信",
      amount: "25.5",
      note: "午饭",
    },
  });

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
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("2026 年 10 月");
  await user.type(screen.getByLabelText("分类"), "餐饮");
  await user.type(screen.getByLabelText("金额"), "25.5");
  await user.click(screen.getByRole("button", { name: "生成提案" }));
  await screen.findByText(/后自动记入/);

  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(await screen.findByText("已取消,未写入")).toBeInTheDocument();
  expect(
    calls.some(({ url }) =>
      url.endsWith("/api/ledger/proposals/lp-test-1/cancel"),
    ),
  ).toBe(true);
});
