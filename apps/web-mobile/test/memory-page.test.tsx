/**
 * Memory page flows (mobile) with fetch routed by URL: grouped reads,
 * exact-line writes, the off-record toggle, markdown download and the
 * corrupt-file refusal. Deliberately mirrors the PC test; no real network.
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
import { afterEach, expect, it, vi } from "vitest";
import { MemoryPage } from "../src/features/memory/MemoryPage.tsx";

const ENTRIES = [
  { type: "约定", text: "咖啡记「饮品」", expired: false },
  { type: "关于我", text: "不吃香菜", expired: false },
  { type: "人物", name: "小王", text: "房东", expired: false },
  {
    type: "约定",
    text: "出差期间餐饮记「差旅」",
    until: "2026-01-01",
    expired: true,
  },
];

const calls: { url: string; init?: RequestInit }[] = [];
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch({ corrupt = false }: { corrupt?: boolean } = {}): void {
  calls.length = 0;
  let offRecord = false;
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
      if (url.endsWith("/api/memory/export")) {
        return Promise.resolve(
          new Response("## 约定\n\n- 咖啡记「饮品」\n", {
            status: 200,
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          }),
        );
      }
      if (url.endsWith("/api/memory/entries")) {
        return Promise.resolve(
          json({
            action: "remembered",
            type: body.type,
            after: `- ${body.text}`,
            created_at: "2026-11-14T08:00:00.000Z",
          }),
        );
      }
      if (url.endsWith("/api/memory/entry/replace")) {
        return Promise.resolve(
          json({
            action: body.next === null ? "forgot" : "updated",
            type: body.current.type,
            before: `- ${body.current.text}`,
            ...(body.next === null ? {} : { after: `- ${body.next.text}` }),
            created_at: "2026-11-14T08:00:00.000Z",
          }),
        );
      }
      if (url.endsWith("/api/memory")) {
        return Promise.resolve(
          corrupt
            ? json(
                {
                  errorCode: "MEMORY_FILE_INVALID",
                  message: "line 4 cannot be parsed",
                },
                500,
              )
            : json({ entries: ENTRIES }),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

it("renders the three memo sections and puts expired entries last", async () => {
  routeFetch();
  renderPage();

  expect(await screen.findByText("咖啡记「饮品」")).toBeInTheDocument();
  expect(screen.getByText("不吃香菜")).toBeInTheDocument();
  expect(screen.getByText(/房东/)).toBeInTheDocument();
  expect(screen.getByText("至 2026-01-01")).toBeInTheDocument();

  const aboutHeading = screen.getByRole("heading", { name: "关于我" });
  const expiredHeading = screen.getByRole("heading", { name: "已过期" });
  expect(
    aboutHeading.compareDocumentPosition(expiredHeading) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const expiredSection = expiredHeading.closest("section");
  expect(expiredSection).not.toBeNull();
  expect(
    within(expiredSection as HTMLElement).getByText(/出差期间餐饮/),
  ).toBeInTheDocument();
});

it("adds an entry with the exact remember body", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: "添加约定" }));
  await user.type(screen.getByLabelText("内容"), "出差期间餐饮记「差旅」");
  await user.type(screen.getByLabelText("至日期（可选）"), "2026-12-31");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() =>
    expect(requestBody("/api/memory/entries")).toEqual({
      type: "约定",
      text: "出差期间餐饮记「差旅」",
      until: "2026-12-31",
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "已记住" }),
  ).toBeInTheDocument();
});

it("edits an entry through replaceExact without sending the view flag", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "编辑 咖啡记「饮品」" }),
  );
  const input = screen.getByLabelText("内容");
  await user.clear(input);
  await user.type(input, "咖啡记「饮品」，不加糖");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() =>
    expect(requestBody("/api/memory/entry/replace")).toEqual({
      current: { type: "约定", text: "咖啡记「饮品」" },
      next: { type: "约定", text: "咖啡记「饮品」，不加糖" },
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "已更新" }),
  ).toBeInTheDocument();
});

it("uses a two-step delete and sends null as the replacement", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "删除 咖啡记「饮品」" }),
  );
  expect(
    calls.some(({ url }) => url.endsWith("/api/memory/entry/replace")),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "确认删除" }));

  await waitFor(() =>
    expect(requestBody("/api/memory/entry/replace")).toEqual({
      current: { type: "约定", text: "咖啡记「饮品」" },
      next: null,
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "已清理" }),
  ).toBeInTheDocument();
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

it("exports MEMORY.md as a client-side download", async () => {
  routeFetch();
  const user = userEvent.setup();
  const createObjectURL = vi.fn(() => "blob:memory-test");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  renderPage();

  await user.click(await screen.findByRole("button", { name: "导出 .md" }));

  await waitFor(() => expect(downloaded).toBe("MEMORY.md"));
  expect(calls.some(({ url }) => url.endsWith("/api/memory/export"))).toBe(
    true,
  );
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:memory-test");
});

it("shows the corrupt-file guidance instead of a fake empty list", async () => {
  routeFetch({ corrupt: true });
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "记忆文件需要修复" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/请手工修复 MEMORY.md/)).toBeInTheDocument();
  expect(screen.getByText(/页面不会改写或跳过/)).toBeInTheDocument();
  expect(screen.queryByText("咖啡记「饮品」")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "添加约定" }),
  ).not.toBeInTheDocument();
});
