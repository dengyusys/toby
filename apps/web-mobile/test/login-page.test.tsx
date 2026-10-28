/**
 * Login page render and submit with fetch stubbed to the auth endpoints:
 * the form posts the password, failures show their message, and a disabled
 * deployment shows the plain notice instead of a form.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { LoginPage } from "../src/features/auth/LoginPage.tsx";

const calls: { url: string; init?: RequestInit }[] = [];

function routeFetch(session: unknown, loginStatus = 200): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = url.endsWith("/api/auth/session")
        ? session
        : loginStatus === 200
          ? { status: "ok" }
          : {
              statusCode: loginStatus,
              message: "wrong password",
              error: "Unauthorized",
              errorCode: "INVALID_CREDENTIALS",
            };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: loginStatus,
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
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the form when auth is enabled and posts the password", async () => {
  routeFetch({ enabled: true, authenticated: false });
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByLabelText("密码"), "hunter2");
  await user.click(screen.getByRole("button", { name: "登录" }));

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/login"));
  expect(sent?.init?.method).toBe("POST");
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ password: "hunter2" });
});

it("shows the server message on wrong passwords", async () => {
  routeFetch({ enabled: true, authenticated: false }, 401);
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByLabelText("密码"), "nope");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByText("密码不对")).toBeInTheDocument();
});

it("shows the no-password notice when auth is disabled", async () => {
  routeFetch({ enabled: false, authenticated: false });
  renderPage();

  expect(await screen.findByText("登录未启用")).toBeInTheDocument();
  expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
});
