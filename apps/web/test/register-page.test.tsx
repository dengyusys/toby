/**
 * Registration page with fetch stubbed to the auth endpoints: it posts the
 * password — however short — once both fields agree, explains a
 * closed startup window, and leaves the page whenever the deployment is no
 * longer unregistered.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { RegisterPage } from "../src/features/auth/RegisterPage.tsx";

const PASSWORD = "hunter2hunter2";

const calls: { url: string; init?: RequestInit }[] = [];

/** `errorCode` is what a failing registration answers with. */
function routeFetch(
  session: unknown,
  registerErrorCode?: "REGISTRATION_CLOSED" | "ALREADY_REGISTERED",
): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const isSession = url.endsWith("/api/auth/session");
      const body = isSession
        ? session
        : registerErrorCode
          ? {
              statusCode: 403,
              message: "registration refused",
              error: "Forbidden",
              errorCode: registerErrorCode,
            }
          : { status: "ok" };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: isSession || !registerErrorCode ? 200 : 403,
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
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/" element={<div>chat page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fill(password: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("密码"), password);
  await user.type(screen.getByLabelText("确认密码"), confirm);
  await user.click(screen.getByRole("button", { name: "注册" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("posts the password once both fields agree", async () => {
  routeFetch({ state: "unregistered" });
  renderPage();

  await fill(PASSWORD, PASSWORD);

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/register"));
  expect(sent?.init?.method).toBe("POST");
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ password: PASSWORD });
});

it("posts a short password just the same", async () => {
  routeFetch({ state: "unregistered" });
  renderPage();

  await fill("1234", "1234");

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/register"));
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ password: "1234" });
});

it("refuses a mismatched password without calling the server", async () => {
  routeFetch({ state: "unregistered" });
  renderPage();

  await fill("1234", "5678");
  expect(await screen.findByText("两次输入的密码不一致")).toBeInTheDocument();

  expect(calls.some(({ url }) => url.endsWith("/api/auth/register"))).toBe(
    false,
  );
});

it("explains a closed startup window", async () => {
  routeFetch({ state: "unregistered" }, "REGISTRATION_CLOSED");
  renderPage();

  await fill(PASSWORD, PASSWORD);

  expect(
    await screen.findByText("设置时间已过,请重启 Toby 服务后刷新本页"),
  ).toBeInTheDocument();
});

it("continues to the login page when the password was set elsewhere", async () => {
  routeFetch({ state: "unregistered" }, "ALREADY_REGISTERED");
  renderPage();

  await fill(PASSWORD, PASSWORD);

  expect(await screen.findByText("login page")).toBeInTheDocument();
});

it("sends a logged-in visitor to the app and a logged-out one to login", async () => {
  routeFetch({ state: "authenticated" });
  renderPage();
  expect(await screen.findByText("chat page")).toBeInTheDocument();
  cleanup();

  routeFetch({ state: "unauthenticated" });
  renderPage();
  expect(await screen.findByText("login page")).toBeInTheDocument();
  expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
});
