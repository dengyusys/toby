/**
 * The settings page's tabs, driven through the real route table (App.tsx):
 * /settings lands on the model tab, each tab is its own address and marks
 * itself current, a direct visit opens that tab, and only the tab on screen
 * asks for its data.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";

const calls: string[] = [];

/** Everything the settings routes ask for; anything else answers 404. */
function routeFetch(): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        );
      if (url.endsWith("/api/auth/session")) {
        return json({ state: "authenticated" });
      }
      if (url.endsWith("/api/settings/ai")) {
        return json({
          model: { value: null, source: null },
          providers: [],
          chat_history_hours: { value: 24, source: "env" },
        });
      }
      if (url.endsWith("/api/settings/ai/catalog")) {
        return json({ providers: [] });
      }
      if (url.endsWith("/api/auth/tokens")) {
        return json({ tokens: [] });
      }
      return json({ statusCode: 404 }, 404);
    }),
  );
}

/** The layout opens one trace stream; the test environment has none. */
function stubEventSource(): void {
  vi.stubGlobal(
    "EventSource",
    class {
      onopen() {}
      onerror() {}
      addEventListener() {}
      close() {}
    },
  );
}

/** Shows where the router is, so a test can read the address bar. */
function WhereAmI() {
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}

function renderApp(at: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <App />
        <WhereAmI />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pathname = () => screen.getByTestId("pathname").textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("/settings lands on the model tab, marked current", async () => {
  routeFetch();
  stubEventSource();
  renderApp("/settings");

  expect(await screen.findByText("对话记忆时长")).toBeInTheDocument();
  expect(pathname()).toBe("/settings/ai");
  expect(screen.getByRole("link", { name: "模型" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(calls).toContain("/api/settings/ai");
});

it("each tab is its own address: the bar switches the panel and the URL follows", async () => {
  routeFetch();
  stubEventSource();
  const user = userEvent.setup();
  renderApp("/settings");
  await screen.findByText("对话记忆时长");

  await user.click(screen.getByRole("link", { name: "登录密码" }));
  expect(await screen.findByLabelText("当前密码")).toBeInTheDocument();
  expect(pathname()).toBe("/settings/password");
  expect(screen.getByRole("link", { name: "登录密码" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByText("对话记忆时长")).not.toBeInTheDocument();

  await user.click(screen.getByRole("link", { name: "访问令牌" }));
  expect(await screen.findByText("已有的令牌")).toBeInTheDocument();
  expect(pathname()).toBe("/settings/tokens");
  expect(screen.getByRole("link", { name: "访问令牌" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByLabelText("当前密码")).not.toBeInTheDocument();
  // The model tab is no longer the current one.
  expect(screen.getByRole("link", { name: "模型" })).not.toHaveAttribute(
    "aria-current",
  );
});

it("a direct visit opens that tab", async () => {
  routeFetch();
  stubEventSource();
  renderApp("/settings/tokens");

  expect(await screen.findByText("还没有令牌。")).toBeInTheDocument();
  expect(pathname()).toBe("/settings/tokens");
  expect(screen.getByRole("link", { name: "访问令牌" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("only the tab on screen asks for its data", async () => {
  routeFetch();
  stubEventSource();
  const user = userEvent.setup();
  renderApp("/settings/password");

  expect(await screen.findByLabelText("当前密码")).toBeInTheDocument();
  expect(calls).not.toContain("/api/settings/ai");
  expect(calls).not.toContain("/api/auth/tokens");

  await user.click(screen.getByRole("link", { name: "访问令牌" }));
  await waitFor(() => expect(calls).toContain("/api/auth/tokens"));
  expect(calls).not.toContain("/api/settings/ai");
});
