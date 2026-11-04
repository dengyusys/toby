/**
 * The drawer logout button: opening the menu and clicking 退出登录 posts
 * /api/auth/logout, drops the cached session, and the route gate walks the
 * app to the login page.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { RequireAuth } from "../src/features/auth/RequireAuth.tsx";
import { AppLayout } from "../src/layouts/AppLayout.tsx";

const calls: string[] = [];

// First session answer is authenticated (so the layout renders); every later
// one — the gate's refetch after the cached session is dropped — is not.
let sessionCalls = 0;

function routeFetch(): void {
  calls.length = 0;
  sessionCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = url.endsWith("/api/auth/logout")
        ? { status: "ok" }
        : { enabled: true, authenticated: sessionCalls++ === 0 };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<div>chat page</div>} />
            </Route>
          </Route>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("logs out from the nav drawer and lands on the login page", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderLayout();

  await user.click(await screen.findByRole("button", { name: "打开菜单" }));
  await user.click(screen.getByRole("button", { name: "退出登录" }));

  expect(await screen.findByText("login page")).toBeInTheDocument();
  expect(calls.some((url) => url.endsWith("/api/auth/logout"))).toBe(true);
  expect(screen.queryByText("chat page")).not.toBeInTheDocument();
});
