/**
 * Ledger page flow (mobile) with fetch stubbed to the ledger endpoints:
 * month report rendering and the proposal commit round trip. Mobile owns
 * its own page; this file mirrors the PC test deliberately.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerPage } from "../src/features/ledger/LedgerPage.tsx";

const MONTHS = { months: ["2026-10"] };
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
  ],
  income_total: 0,
  expense_total: 2550,
  categories: [{ type: "expense", category: "餐饮", total: 2550 }],
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
  ],
};
const COMMITTED = {
  proposal_id: "lp-test-1",
  status: "committed",
  written: 1,
  transaction_ids: [2],
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

it("renders the month calendar with the default day panel", async () => {
  routeFetch();
  renderPage();

  expect(await screen.findByText("¥25.50")).toBeInTheDocument();
  expect(screen.getByText("支 · 餐饮 ¥25.50")).toBeInTheDocument();
  // Default selection follows the data: the latest transaction's day.
  expect(screen.getByText("餐饮 · 午饭")).toBeInTheDocument();
  expect(screen.getByText("-¥25.50")).toBeInTheDocument();
  expect(screen.getByText("支出 ¥25.50 · 收入 ¥0.00")).toBeInTheDocument();
});

it("creates a proposal from the form; the card counts down and lands in a terminal state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("月度账本");

  await user.type(screen.getByLabelText("分类"), "餐饮");
  await user.type(screen.getByLabelText("账户"), "微信");
  await user.type(screen.getByLabelText("金额"), "25.5");
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
      note: "",
    },
  });

  expect(await screen.findByText(/后自动记入/)).toBeInTheDocument();

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

it("submits a sentence and shows the AI follow-up question", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("月度账本");

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
