/**
 * Ledger page flow with fetch stubbed to the ledger endpoints: the month
 * calendar and its day panel (the conversation lives on the chat page
 * now — test/chat-page.test.tsx). No real network, no server.
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
      amount: 2550,
      note: "午饭",
      created_at: "2026-10-20T08:00:00.000Z",
    },
    {
      id: 2,
      date: "2026-10-09",
      type: "income",
      category: "工资",
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
const FOLLOW_UP = { question: "这笔是支出还是收入?" };

// Fresh receipts get unique transaction ids per stub call.
let receiptCounter = 0;

function receiptStub() {
  receiptCounter += 1;
  const now = Date.now();
  return {
    created_at: new Date(now).toISOString(),
    written: 2,
    transaction_ids: [3 + receiptCounter * 2, 4 + receiptCounter * 2],
    entries: [
      {
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        amount: 2550,
        note: "午饭",
      },
      {
        date: "2026-10-20",
        type: "income",
        category: "退款",
        amount: 1250,
        note: "",
      },
    ],
  };
}

const calls: { url: string; init?: RequestInit }[] = [];

function routeFetch({
  textResults = ["follow-up"],
}: {
  textResults?: ("follow-up" | "receipt")[];
} = {}): void {
  calls.length = 0;
  receiptCounter = 0;
  // One queued outcome per text write, in order; exhausted → follow-up.
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
              action: "deleted",
              deleted_at: new Date().toISOString(),
            }
          : url.startsWith("/api/ledger/transactions")
            ? REPORT
            : typeof requestBody.text === "string"
              ? (queue.shift() ?? textResults.at(-1) ?? "follow-up") ===
                "follow-up"
                ? FOLLOW_UP
                : receiptStub()
              : receiptStub();
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
