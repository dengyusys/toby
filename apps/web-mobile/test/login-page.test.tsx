/**
 * Login page render and submit with fetch stubbed to the auth endpoints:
 * the form posts the password, the eye toggle reveals and hides the typed
 * value, failures show their message, and a deployment without a password
 * shows the register-on-PC notice instead of a form.
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

it("renders the form on a registered deployment and posts the password", async () => {
  routeFetch({ state: "unauthenticated" });
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByLabelText("密码"), "hunter2");
  await user.click(screen.getByRole("button", { name: "登录" }));

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/login"));
  expect(sent?.init?.method).toBe("POST");
  expect(JSON.parse(String(sent?.init?.body))).toEqual({ password: "hunter2" });
});

it("toggles the password field between hidden and visible", async () => {
  routeFetch({ state: "unauthenticated" });
  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByLabelText("密码")).toHaveAttribute(
    "type",
    "password",
  );

  await user.click(screen.getByRole("button", { name: "显示密码" }));
  expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");

  await user.click(screen.getByRole("button", { name: "隐藏密码" }));
  expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
});

it("shows the server message on wrong passwords", async () => {
  routeFetch({ state: "unauthenticated" }, 401);
  const user = userEvent.setup();
  renderPage();

  await user.type(await screen.findByLabelText("密码"), "nope");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(await screen.findByText("密码不对")).toBeInTheDocument();
});

it("shows the register-on-PC notice instead of a form while unregistered", async () => {
  routeFetch({ state: "unregistered" });
  renderPage();

  expect(await screen.findByText("请先在电脑端完成注册")).toBeInTheDocument();
  expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
});

it("asks the server again once the visitor comes back registered", async () => {
  // First answer: no password yet. The answer after the retry: registered.
  let sessionCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/api/auth/session")
        ? { state: sessionCalls++ === 0 ? "unregistered" : "unauthenticated" }
        : { status: "ok" };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("请先在电脑端完成注册");
  await user.click(screen.getByRole("button", { name: "我已设置,重新检查" }));

  expect(await screen.findByLabelText("密码")).toBeInTheDocument();
  expect(sessionCalls).toBe(2);
});
