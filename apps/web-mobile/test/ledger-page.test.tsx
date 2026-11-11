/**
 * Ledger page flow (mobile) with fetch stubbed to the ledger endpoints:
 * the month calendar and its day panel (the conversation lives on the
 * chat page now — test/chat-page.test.tsx). Mobile owns its own page;
 * this file mirrors the PC test deliberately.
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
      amount: 2550,
      note: "午饭",
      created_at: "2026-10-20T08:00:00.000Z",
    },
  ],
  income_total: 0,
  expense_total: 2550,
  categories: [{ type: "expense", category: "餐饮", total: 2550 }],
};
const FOLLOW_UP = { question: "这笔是支出还是收入?" };

// Fresh receipts get unique ids and a future revert window (the countdown
// must not reach zero inside a test); revert echoes the id from the URL.
let receiptCounter = 0;

function receiptStub(
  options: { windowClosed?: boolean; windowMs?: number } = {},
) {
  receiptCounter += 1;
  const now = Date.now();
  const windowMs = options.windowClosed
    ? -1_000
    : (options.windowMs ?? 600_000);
  return {
    proposal_id: `lp-test-${receiptCounter}`,
    status: "committed",
    created_at: new Date(now).toISOString(),
    committed_at: new Date(now).toISOString(),
    revert_until: new Date(now + windowMs).toISOString(),
    written: 1,
    transaction_ids: [2],
    entries: [
      {
        date: "2026-10-20",
        type: "expense",
        category: "餐饮",
        amount: 2550,
        note: "午饭",
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
  windowClosed = false,
  windowMs,
  revertFails = false,
}: {
  textResults?: ("follow-up" | "receipt")[];
  windowClosed?: boolean;
  windowMs?: number;
  revertFails?: boolean;
} = {}): void {
  calls.length = 0;
  receiptCounter = 0;
  // One queued outcome per text proposal, in order; exhausted → follow-up.
  const queue = [...textResults];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.endsWith("/revert") && revertFails) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 409,
              message: "a later write touched this batch",
              error: "Conflict",
              errorCode: "REVERT_CONFLICT",
            }),
            { status: 409 },
          ),
        );
      }
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
            : url.endsWith("/revert")
              ? {
                  proposal_id: proposalIdFromUrl(url),
                  status: "reverted",
                  reverted_at: new Date().toISOString(),
                }
              : typeof requestBody.text === "string"
                ? (queue.shift() ?? textResults.at(-1) ?? "follow-up") ===
                  "follow-up"
                  ? FOLLOW_UP
                  : receiptStub({ windowClosed, windowMs })
                : receiptStub({ windowClosed, windowMs });
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

  // Cells carry per-day subtotals; picking a day opens its panel.
  expect(screen.getByText("支 25.50")).toBeInTheDocument();
  await user.click(
    screen.getByRole("gridcell", {
      name: "2026-10-20，支出 25.50，收入 0.00",
    }),
  );
  expect(screen.getByText("餐饮")).toBeInTheDocument();
  expect(screen.getByText("\u221225.50")).toBeInTheDocument();
  // Footer totals row: nested spans split the text, so match on content.
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === "SPAN" &&
        element.textContent === "支出 ¥25.50 · 收入 ¥0.00",
    ),
  ).toBeInTheDocument();
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
