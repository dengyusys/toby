/**
 * The change-password card with fetch stubbed: it posts the current and the
 * new password, refuses a mismatched or unchanged new password
 * without calling the server, and names a wrong current password.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PasswordForm } from "../src/features/settings/PasswordForm.tsx";

const calls: { url: string; init?: RequestInit }[] = [];

function routeFetch(status = 200): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body =
        status === 200
          ? { status: "ok" }
          : {
              statusCode: status,
              message: "wrong password",
              error: "Unauthorized",
              errorCode: "INVALID_CREDENTIALS",
            };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

function renderForm() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PasswordForm />
    </QueryClientProvider>,
  );
}

/** Fills the three fields from scratch — an earlier attempt's text is wiped. */
async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  const currentField = screen.getByLabelText("当前密码");
  const newField = screen.getByLabelText("新密码");
  const confirmField = screen.getByLabelText("确认新密码");
  await user.clear(currentField);
  await user.clear(newField);
  await user.clear(confirmField);
  await user.type(currentField, current);
  await user.type(newField, next);
  await user.type(confirmField, confirm);
  await user.click(screen.getByRole("button", { name: "修改密码" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("posts the current and the new password", async () => {
  routeFetch();
  renderForm();

  await fill("old-password", "new-password-1", "new-password-1");

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/password"));
  expect(sent?.init?.method).toBe("PUT");
  expect(JSON.parse(String(sent?.init?.body))).toEqual({
    current_password: "old-password",
    new_password: "new-password-1",
  });
});

it("accepts a short new password", async () => {
  routeFetch();
  renderForm();

  await fill("old-password", "ab", "ab");

  const sent = calls.find(({ url }) => url.endsWith("/api/auth/password"));
  expect(JSON.parse(String(sent?.init?.body))).toEqual({
    current_password: "old-password",
    new_password: "ab",
  });
});

it("refuses a mismatched or unchanged new password without calling the server", async () => {
  routeFetch();
  renderForm();

  await fill("old-password", "12345678", "87654321");
  expect(await screen.findByText("两次输入的新密码不一致")).toBeInTheDocument();

  await fill("same-password", "same-password", "same-password");
  expect(
    await screen.findByText("新密码不能与当前密码相同"),
  ).toBeInTheDocument();

  expect(calls).toHaveLength(0);
});

it("names a wrong current password and clears every field", async () => {
  routeFetch(401);
  renderForm();

  await fill("old-password", "new-password-1", "new-password-1");

  expect(await screen.findByText("当前密码不对")).toBeInTheDocument();
  expect(screen.getByLabelText("当前密码")).toHaveValue("");
  expect(screen.getByLabelText("新密码")).toHaveValue("");
  expect(screen.getByLabelText("确认新密码")).toHaveValue("");
});
