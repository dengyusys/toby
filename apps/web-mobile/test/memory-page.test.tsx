/**
 * Memory page flows (mobile) with fetch routed by URL: the read-only raw
 * markdown view, the off-record toggle and the two-step destructive
 * reset. No real network.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryPage } from "../src/features/memory/MemoryPage.tsx";

/** Three entry lines plus their headings — exactly what MEMORY.md holds. */
const RAW = [
  "## 约定",
  "",
  "- 咖啡记「饮品」",
  "",
  "## 关于我",
  "",
  "- 不吃香菜",
  "- 给小王的转账走「人情往来」",
  "",
].join("\n");

const calls: { url: string; init?: RequestInit }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch({
  corrupt = false,
  empty = false,
}: { corrupt?: boolean; empty?: boolean } = {}): void {
  calls.length = 0;
  let offRecord = false;
  let file = empty ? "" : RAW;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.endsWith("/api/memory/off-record")) {
        if (init?.method === "POST") offRecord = body.on;
        return Promise.resolve(json({ on: offRecord }));
      }
      if (url.endsWith("/api/memory/reset")) {
        file = "";
        return Promise.resolve(json({ reset_at: "2026-11-14T08:00:00.000Z" }));
      }
      if (url.endsWith("/api/memory/file")) {
        if (corrupt) {
          return Promise.resolve(
            json(
              {
                errorCode: "MEMORY_FILE_INVALID",
                message: "line 4 cannot be parsed",
              },
              500,
            ),
          );
        }
        return Promise.resolve(
          new Response(file, {
            status: 200,
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          }),
        );
      }
      return Promise.resolve(json({ message: "unexpected route" }, 404));
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryPage />
    </QueryClientProvider>,
  );
}

function requestBody(urlPart: string): Record<string, unknown> {
  const call = calls.find(
    ({ url, init }) => url.endsWith(urlPart) && init?.method === "POST",
  );
  expect(call, `POST ${urlPart}`).toBeDefined();
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
}

function resetWasPosted(): boolean {
  return calls.some(
    ({ url, init }) =>
      url.endsWith("/api/memory/reset") && init?.method === "POST",
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("renders the raw markdown source without any per-line controls", async () => {
  routeFetch();
  renderPage();

  // The file itself, verbatim — headings and entry lines in one block.
  expect(await screen.findByText(/## 约定/)).toBeInTheDocument();
  expect(screen.getByText(/- 咖啡记「饮品」/)).toBeInTheDocument();
  expect(screen.getByText(/- 不吃香菜/)).toBeInTheDocument();

  // Read-only: no row buttons, no editors, no add/rename forms.
  expect(
    screen.queryByRole("button", { name: /编辑/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /删除/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("内容")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("主题")).not.toBeInTheDocument();
});

it("shows the empty state when the file has no content", async () => {
  routeFetch({ empty: true });
  renderPage();

  expect(await screen.findByText(/还没有任何记忆/)).toBeInTheDocument();
  expect(screen.queryByText(/## /)).not.toBeInTheDocument();
});

it("toggles off-record and reflects the returned state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  const toggle = await screen.findByRole("button", {
    name: /关闭记忆/,
  });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);

  const enabled = await screen.findByRole("button", {
    name: /开启记忆/,
  });
  expect(enabled).toHaveAttribute("aria-pressed", "true");
  expect(requestBody("/api/memory/off-record")).toEqual({ on: true });
});

it("reset confirms with the entry count, posts once and refetches to the empty state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();
  await screen.findByText(/## 约定/);

  // Two-step: opening the panel sends nothing.
  await user.click(screen.getByRole("button", { name: "重置" }));
  expect(resetWasPosted()).toBe(false);
  expect(
    screen.getByRole("heading", { name: "重置记忆？" }),
  ).toBeInTheDocument();
  // RAW has exactly three "- " lines, counted client-side.
  expect(screen.getByText(/将清空全部 3 条记忆/)).toBeInTheDocument();
  expect(screen.getByText("此操作不可撤销。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认重置" }));

  await waitFor(() => expect(resetWasPosted()).toBe(true));
  // The invalidated raw query refetches the now-cleared file.
  expect(await screen.findByText(/还没有任何记忆/)).toBeInTheDocument();
});

it("cancel keeps the file and never posts the reset", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();
  await screen.findByText(/## 约定/);

  await user.click(screen.getByRole("button", { name: "重置" }));
  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(resetWasPosted()).toBe(false);
  expect(screen.getByText(/## 约定/)).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "重置记忆？" }),
  ).not.toBeInTheDocument();
});

it("shows the read error with a retry when export fails", async () => {
  routeFetch({ corrupt: true });
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "无法读取记忆" }),
  ).toBeInTheDocument();
  // The export route now decodes the server's errorCode: the corrupt-file
  // copy names both recovery paths (hand fix or reset).
  expect(
    screen.getByText(/记忆文件损坏，请手工修复 MEMORY\.md，或「重置」清空重来/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新读取" })).toBeInTheDocument();
  expect(screen.queryByText(/## 约定/)).not.toBeInTheDocument();
});

it("still allows reset when the file cannot be read", async () => {
  routeFetch({ corrupt: true });
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("heading", { name: "无法读取记忆" });

  await user.click(screen.getByRole("button", { name: "重置" }));
  // No count can be read — the panel says so and still offers the reset.
  expect(screen.getByText("无法读取文件（可能已损坏）")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确认重置" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "确认重置" }));
  await waitFor(() => expect(resetWasPosted()).toBe(true));
});
