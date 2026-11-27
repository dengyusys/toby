/**
 * The access tokens tab with fetch stubbed to the token routes: the table
 * names each token with its dates, the add button opens a one-field form
 * whose token's secret is shown once and then gone, cancel closes the form,
 * and a row's button revokes that token.
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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccessTokenView } from "@toby/contract";
import { AccessTokensSection } from "../src/features/settings/AccessTokensSection.tsx";

const SECRET = "s3cret-value-7890";
const SCRIPT_CREATED_AT = "2026-11-01T08:00:00.000Z";
const SCRIPT_LAST_USED_AT = "2026-11-20T08:00:00.000Z";

// The table prints in the browser's time zone, and the machine running this
// test has one of its own — CI's is UTC — so the expected text is built the
// way the table builds it, not written out for one time zone.
const DAY = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" });
const DAY_AND_TIME = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "short",
});

function day(iso: string): string {
  return DAY.format(new Date(iso));
}

function dayAndTime(iso: string): string {
  return DAY_AND_TIME.format(new Date(iso));
}

const calls: { method: string; url: string; body?: unknown }[] = [];
let listed: AccessTokenView[] = [];

function routeFetch(): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const json = (value: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(value), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      if (url.endsWith("/api/auth/tokens") && method === "GET") {
        return json({ tokens: listed });
      }
      if (url.endsWith("/api/auth/tokens") && method === "POST") {
        const created = body as { name: string };
        const token: AccessTokenView = {
          id: "token-3",
          name: created.name,
          last_four: SECRET.slice(-4),
          created_at: "2026-12-01T08:00:00.000Z",
          last_used_at: null,
        };
        return json({ token, secret: SECRET });
      }
      if (method === "DELETE") {
        listed = listed.filter((token) => !url.endsWith(`/${token.id}`));
        return json({
          id: "revoked",
          action: "revoked",
          revoked_at: "2026-12-02T08:00:00.000Z",
        });
      }
      return json({ statusCode: 404 });
    }),
  );
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessTokensSection />
    </QueryClientProvider>,
  );
}

/** The table row that shows this token's name. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) {
    throw new Error(`no table row for ${name}`);
  }
  return row;
}

/** One header row, then one row per token. */
function rowCount(): number {
  return screen.getAllByRole("row").length;
}

beforeEach(() => {
  listed = [
    {
      id: "token-1",
      name: "记账脚本",
      last_four: "wxyz",
      created_at: SCRIPT_CREATED_AT,
      last_used_at: SCRIPT_LAST_USED_AT,
    },
    {
      id: "token-2",
      name: "看板",
      last_four: "abcd",
      created_at: "2026-11-10T08:00:00.000Z",
      last_used_at: null,
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists each token in the table with its dates", async () => {
  routeFetch();
  renderSection();

  await screen.findByText("记账脚本");
  expect(
    screen.getByRole("columnheader", { name: "创建时间" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("columnheader", { name: "最近使用" }),
  ).toBeInTheDocument();

  const script = within(rowOf("记账脚本"));
  expect(script.getByText(dayAndTime(SCRIPT_CREATED_AT))).toBeInTheDocument();
  // Two spellings share the cell: the day alone, and the day with its time.
  expect(script.getByText(day(SCRIPT_LAST_USED_AT))).toBeInTheDocument();
  expect(script.getByText(dayAndTime(SCRIPT_LAST_USED_AT))).toBeInTheDocument();

  const dashboard = within(rowOf("看板"));
  expect(dashboard.getByText("从未使用")).toBeInTheDocument();
  expect(rowCount()).toBe(3);
});

it("keeps the table, with one line, until the first token exists", async () => {
  listed = [];
  routeFetch();
  renderSection();

  expect(await screen.findByText("还没有令牌。")).toBeInTheDocument();
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("the add button opens the form; creating shows the secret once and closes it", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  // Nothing to fill in until the button is pressed.
  expect(screen.queryByLabelText("名字")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "添加令牌" }));
  await user.type(screen.getByLabelText("名字"), "我的主页");
  await user.click(screen.getByRole("button", { name: "创建" }));

  expect(await screen.findByText(/明文只显示这一次/)).toBeInTheDocument();
  expect(screen.getByLabelText("新令牌明文")).toHaveValue(SECRET);
  const sent = calls.find(({ method }) => method === "POST");
  expect(sent?.body).toEqual({ name: "我的主页" });
  // The table learned the new token without asking again, and the form closed.
  expect(rowCount()).toBe(4);
  expect(screen.queryByLabelText("名字")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "我已保存" }));
  expect(screen.queryByLabelText("新令牌明文")).not.toBeInTheDocument();
  expect(screen.queryByText(/明文只显示这一次/)).not.toBeInTheDocument();
});

it("cancel closes the form without calling the server", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  await user.click(screen.getByRole("button", { name: "添加令牌" }));
  await user.type(screen.getByLabelText("名字"), "半途而废");
  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(screen.queryByLabelText("名字")).not.toBeInTheDocument();
  expect(calls.some(({ method }) => method === "POST")).toBe(false);
  // What was typed is not waiting the next time the form opens.
  await user.click(screen.getByRole("button", { name: "添加令牌" }));
  expect(screen.getByLabelText("名字")).toHaveValue("");
});

it("revokes the token whose button was clicked", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("看板");
  await user.click(within(rowOf("看板")).getByRole("button", { name: "撤销" }));

  await waitFor(() => {
    expect(screen.queryByText("看板")).not.toBeInTheDocument();
  });
  expect(calls).toContainEqual({
    method: "DELETE",
    url: "/api/auth/tokens/token-2",
    body: undefined,
  });
  expect(screen.getByText("记账脚本")).toBeInTheDocument();
});

it("the form has only a name, and refuses an empty one without calling the server", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  await user.click(screen.getByRole("button", { name: "添加令牌" }));
  // Neither an expiry nor a tier: a name is all a token has.
  expect(screen.queryByLabelText("有效期")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect(await screen.findByText("请填写名字")).toBeInTheDocument();

  expect(calls.some(({ method }) => method === "POST")).toBe(false);
});

it("copies the secret to the clipboard", async () => {
  routeFetch();
  const user = userEvent.setup();
  // userEvent installs its own clipboard; this test wants to see the call.
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  try {
    renderSection();

    await screen.findByText("记账脚本");
    await user.click(screen.getByRole("button", { name: "添加令牌" }));
    await user.type(screen.getByLabelText("名字"), "我的主页");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await user.click(await screen.findByRole("button", { name: "复制" }));
    expect(await screen.findByText("已复制到剪贴板。")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SECRET);
  } finally {
    Object.defineProperty(
      navigator,
      "clipboard",
      original ?? {
        value: undefined,
        configurable: true,
      },
    );
  }
});
