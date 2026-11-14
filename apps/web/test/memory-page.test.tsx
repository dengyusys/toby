/**
 * The read-only memory page: MEMORY.md's raw Markdown source in file
 * order, the empty state, the honest corrupt-file surface, the off-record
 * toggle and the two-step reset. Fetch is routed by URL: no real network,
 * no server and no production files.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryPage } from "../src/features/memory/MemoryPage.tsx";

// The file's content as the raw view shows it: headings and "- " entry
// lines in file order, blank lines included — four entries in total.
const RAW_MARKDOWN = [
  "## 约定",
  "",
  "- 咖啡记「饮品」",
  "- 出差期间餐饮记「差旅」",
  "",
  "## 关于我",
  "",
  "- 不吃香菜",
  "- 小王:房东",
].join("\n");

const calls: { url: string; init?: RequestInit }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RouteOptions {
  /** The file is unreadable: the file route fails like a corrupt file. */
  corrupt?: boolean;
  /** The file exists but holds only whitespace. */
  empty?: boolean;
  /** The reset endpoint answers 500. */
  resetFails?: boolean;
}

function routeFetch({
  corrupt = false,
  empty = false,
  resetFails = false,
}: RouteOptions = {}): void {
  calls.length = 0;
  let offRecord = false;
  let cleared = false;
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
        const markdown = cleared ? "" : empty ? "\n \n" : RAW_MARKDOWN;
        return Promise.resolve(
          new Response(markdown, {
            status: 200,
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          }),
        );
      }
      if (url.endsWith("/api/memory/reset")) {
        if (resetFails) {
          return Promise.resolve(
            json(
              {
                errorCode: "MEMORY_FILE_INVALID",
                message: "cannot truncate a corrupt file",
              },
              500,
            ),
          );
        }
        cleared = true;
        return Promise.resolve(json({ reset_at: "2026-11-14T08:00:00.000Z" }));
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

function wasResetPosted(): boolean {
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

it("renders MEMORY.md's raw source in file order", async () => {
  routeFetch();
  renderPage();

  // The regex matches only the <pre>, which directly holds the whole file
  // text; its content is the verbatim source, so order comes for free.
  const raw = await screen.findByText(/咖啡记「饮品」/);
  expect(raw.tagName).toBe("PRE");
  expect(raw.textContent).toBe(RAW_MARKDOWN);

  // Read-only: no editors, no per-line buttons, no forms.
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "添加约定" }),
  ).not.toBeInTheDocument();
});

it("shows the empty state for an empty or whitespace-only file", async () => {
  routeFetch({ empty: true });
  renderPage();

  expect(await screen.findByText(/还没有任何记忆/)).toBeInTheDocument();
  expect(screen.queryByText(/咖啡记/)).not.toBeInTheDocument();
});

it("toggles off-record and reflects the returned state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  const toggle = await screen.findByRole("button", {
    name: /关闭记忆/,
  });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(toggle).toHaveAttribute(
    "title",
    "关闭后需手动重新开启；重启服务也会恢复记忆",
  );
  await user.click(toggle);

  const enabled = await screen.findByRole("button", {
    name: /开启记忆/,
  });
  expect(enabled).toHaveAttribute("aria-pressed", "true");
  expect(
    calls.some(
      ({ url, init }) =>
        url.endsWith("/api/memory/off-record") && init?.method === "POST",
    ),
  ).toBe(true);
});

it("resets through the inline confirm and refetches to the empty state", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText(/咖啡记「饮品」/);
  await user.click(screen.getByRole("button", { name: "重置" }));

  // Two-step: the panel counts the "- " lines client-side and warns that
  // the reset cannot be undone; nothing is sent until 确认重置.
  expect(screen.getByText(/将清空 4 条记忆/)).toBeInTheDocument();
  expect(screen.getByText(/此操作不可撤销/)).toBeInTheDocument();
  expect(wasResetPosted()).toBe(false);

  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(
    screen.queryByRole("button", { name: "确认重置" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重置" }));
  await user.click(screen.getByRole("button", { name: "确认重置" }));

  await waitFor(() => expect(wasResetPosted()).toBe(true));
  expect(await screen.findByText(/还没有任何记忆/)).toBeInTheDocument();
});

it("shows the honest broken state and still allows reset", async () => {
  routeFetch({ corrupt: true });
  const user = userEvent.setup();
  renderPage();

  // The heading depends on whether the client maps the file error to
  // MEMORY_FILE_INVALID; either way the failure is shown, never faked.
  expect(
    await screen.findByText(/无法读取记忆文件|记忆文件需要修复/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/line 4 cannot be parsed|记忆文件损坏/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/咖啡记/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重置" }));
  expect(screen.getByText(/无法读取文件（可能已损坏）/)).toBeInTheDocument();
  expect(screen.queryByText(/将清空/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认重置" }));
  await waitFor(() => expect(wasResetPosted()).toBe(true));
});

it("surfaces reset failures and keeps the confirm panel open", async () => {
  routeFetch({ resetFails: true });
  const user = userEvent.setup();
  renderPage();

  await screen.findByText(/咖啡记「饮品」/);
  await user.click(screen.getByRole("button", { name: "重置" }));
  await user.click(screen.getByRole("button", { name: "确认重置" }));

  // The route answers MEMORY_FILE_INVALID; describeError renders its
  // fixed copy for that code, not the raw server message.
  expect(await screen.findByText(/重置失败：/)).toBeInTheDocument();
  expect(screen.getByText(/记忆文件损坏/)).toBeInTheDocument();
  // The panel stays open so the reset can be retried or cancelled.
  expect(screen.getByRole("button", { name: "确认重置" })).toBeEnabled();
});
