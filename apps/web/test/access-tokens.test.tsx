/**
 * The access tokens card with fetch stubbed to the token routes: the list
 * names each token with its tier and last use, a new token's secret is
 * shown once and then gone, an expiry is sent only when asked for, and a
 * row's button revokes that token.
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
        const created = body as {
          name: string;
          scopes: string[];
          expires_at?: string;
        };
        const token: AccessTokenView = {
          id: "token-3",
          name: created.name,
          scopes: created.scopes as AccessTokenView["scopes"],
          last_four: SECRET.slice(-4),
          created_at: "2026-12-01T08:00:00.000Z",
          last_used_at: null,
          expires_at: created.expires_at ?? null,
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

/** The list row that shows this token's name. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("li");
  if (!row) {
    throw new Error(`no list row for ${name}`);
  }
  return row;
}

beforeEach(() => {
  listed = [
    {
      id: "token-1",
      name: "记账脚本",
      scopes: ["write"],
      last_four: "wxyz",
      created_at: "2026-11-01T08:00:00.000Z",
      last_used_at: "2026-11-20T08:00:00.000Z",
      expires_at: null,
    },
    {
      id: "token-2",
      name: "看板",
      scopes: ["read"],
      last_four: "abcd",
      created_at: "2026-11-10T08:00:00.000Z",
      last_used_at: null,
      expires_at: "2027-01-01T00:00:00.000Z",
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists each token with its tier, its end, and its last use", async () => {
  routeFetch();
  renderSection();

  await screen.findByText("记账脚本");
  const script = within(rowOf("记账脚本"));
  expect(script.getByText(/读写/)).toBeInTheDocument();
  expect(script.getByText(/永不过期/)).toBeInTheDocument();
  expect(script.getByText(/最近使用/)).toBeInTheDocument();

  const dashboard = within(rowOf("看板"));
  expect(dashboard.getByText(/只读/)).toBeInTheDocument();
  expect(dashboard.getByText(/过期/)).toBeInTheDocument();
  expect(dashboard.getByText(/从未使用/)).toBeInTheDocument();
});

it("creates a read-only token and shows its secret exactly once", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  await user.type(screen.getByLabelText("名字"), "我的主页");
  expect(screen.getByRole("radio", { name: "只读" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "创建令牌" }));

  expect(await screen.findByText(/明文只显示这一次/)).toBeInTheDocument();
  expect(screen.getByLabelText("新令牌明文")).toHaveValue(SECRET);
  const sent = calls.find(({ method }) => method === "POST");
  expect(sent?.body).toEqual({ name: "我的主页", scopes: ["read"] });
  // The list learned the new token without asking again.
  expect(screen.getAllByRole("listitem")).toHaveLength(3);

  await user.click(screen.getByRole("button", { name: "我已保存" }));
  expect(screen.queryByLabelText("新令牌明文")).not.toBeInTheDocument();
  expect(screen.queryByText(/明文只显示这一次/)).not.toBeInTheDocument();
});

it("sends an expiry only when a number of days is given", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  await user.type(screen.getByLabelText("名字"), "临时脚本");
  await user.type(screen.getByLabelText("有效天数"), "30");
  await user.click(screen.getByRole("radio", { name: "读写" }));
  await user.click(screen.getByRole("button", { name: "创建令牌" }));

  await screen.findByText(/明文只显示这一次/);
  const sent = calls.find(({ method }) => method === "POST");
  expect(sent?.body).toMatchObject({ name: "临时脚本", scopes: ["write"] });
  expect(String((sent?.body as { expires_at?: string }).expires_at)).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
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

it("refuses an empty name or a bad number of days without calling the server", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderSection();

  await screen.findByText("记账脚本");
  await user.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByText("请填写名字")).toBeInTheDocument();

  await user.type(screen.getByLabelText("名字"), "零天");
  await user.type(screen.getByLabelText("有效天数"), "0");
  await user.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(
    await screen.findByText("有效天数必须是大于 0 的整数"),
  ).toBeInTheDocument();

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
    await user.type(screen.getByLabelText("名字"), "我的主页");
    await user.click(screen.getByRole("button", { name: "创建令牌" }));

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
