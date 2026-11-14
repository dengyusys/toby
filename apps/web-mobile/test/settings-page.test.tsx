import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { AiSettingsView, AiTestResult } from "@toby/contract";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/features/settings/SettingsPage.tsx";

const initial: AiSettingsView = {
  model: { value: "example/first", source: "db" },
  providers: [{ id: "example", source: "stored", maskedKey: "***" }],
};
const ok: AiTestResult = {
  stage: "ok",
  model: "example/second",
  latencyMs: 42,
  reply: "Hello",
  message: null,
};
const calls: { method?: string; body: unknown }[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch({
  probe = () => Promise.resolve(json(ok)),
  save = () => Promise.resolve(json(initial)),
  catalog = () =>
    Promise.resolve(
      json({ providers: [{ id: "example", models: ["first", "second"] }] }),
    ),
}: {
  probe?: () => Promise<Response>;
  save?: () => Promise<Response>;
  catalog?: () => Promise<Response>;
} = {}) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/catalog")) return catalog();
      if (init?.body) {
        calls.push({
          method: init.method,
          body: JSON.parse(String(init.body)),
        });
      }
      if (url.endsWith("/test")) return probe();
      if (init?.method === "PUT") return save();
      return Promise.resolve(json(initial));
    }),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("tests unsaved model and key, then saves the same body and clears feedback on edits", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  await waitFor(() => expect(test).toBeEnabled());
  await user.selectOptions(screen.getByLabelText("模型"), "example/second");
  await user.type(screen.getByLabelText("API key"), "fake-test-key");
  await user.click(test);

  expect(await screen.findByText("连接成功 · 42ms")).toBeInTheDocument();
  expect(calls).toEqual([
    {
      method: "POST",
      body: {
        model: "example/second",
        credentials: [{ provider: "example", apiKey: "fake-test-key" }],
      },
    },
  ]);
  expect(screen.getByLabelText("API key")).toHaveValue("fake-test-key");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("已保存");
  expect(calls[1]).toEqual({ ...calls[0], method: "PUT" });
  expect(screen.queryByText("连接成功 · 42ms")).not.toBeInTheDocument();

  await user.click(test);
  await screen.findByText("连接成功 · 42ms");
  await user.type(screen.getByLabelText("API key"), "x");
  expect(screen.queryByText("连接成功 · 42ms")).not.toBeInTheDocument();
});

it("tests unchanged settings with an empty body and supports reset plus credential clearing", async () => {
  routeFetch();
  const user = userEvent.setup();
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  await waitFor(() => expect(test).toBeEnabled());
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  await user.click(test);
  await screen.findByText("连接成功 · 42ms");
  expect(calls[0]).toEqual({ method: "POST", body: {} });
  await user.click(screen.getByRole("button", { name: "恢复环境配置" }));
  await user.click(screen.getByRole("button", { name: "清除密钥" }));
  await user.click(test);
  await screen.findByText("连接成功 · 42ms");
  expect(calls[1]).toEqual({
    method: "POST",
    body: { model: null, credentials: [{ provider: "example", clear: true }] },
  });
});

it.each([
  ["unconfigured", "尚未配置模型"],
  ["invalid-model", "模型不可用，请重新选择"],
  ["auth", "密钥无效或未配置"],
  ["timeout", "请求超时"],
  ["request-failed", "请求失败：provider unavailable"],
] as const)("shows the %s probe result", async (stage, message) => {
  routeFetch({
    probe: () =>
      Promise.resolve(json({ ...ok, stage, message: "provider unavailable" })),
  });
  const user = userEvent.setup();
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  await waitFor(() => expect(test).toBeEnabled());
  await user.click(test);
  const result = await screen.findByText(message);
  expect(result).toHaveAttribute("aria-live", "polite");
});

it("maps rejected test requests to the existing field errors", async () => {
  routeFetch({
    probe: () =>
      Promise.resolve(
        json({ errorCode: "SETTINGS_INVALID_CREDENTIAL", message: "bad" }, 400),
      ),
  });
  const user = userEvent.setup();
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  await waitFor(() => expect(test).toBeEnabled());
  await user.click(test);
  expect(
    await screen.findByText("密钥格式无效，请重新输入。"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("API key")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

it("disables both actions and fields while testing or saving", async () => {
  let finish: (response: Response) => void = () => {};
  const pending = () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  routeFetch({ probe: pending, save: pending });
  const user = userEvent.setup();
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  await waitFor(() => expect(test).toBeEnabled());
  await user.type(screen.getByLabelText("API key"), "fake-test-key");
  await user.click(test);
  expect(screen.getByText("正在测试…")).toHaveAttribute("aria-live", "polite");
  expect(screen.getByRole("button", { name: "测试中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByLabelText("供应商")).toBeDisabled();
  expect(screen.getByLabelText("模型")).toBeDisabled();
  expect(screen.getByLabelText("API key")).toBeDisabled();
  await act(async () => finish(json(ok)));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
  expect(test).toBeDisabled();
  expect(screen.getByLabelText("API key")).toBeDisabled();
  await act(async () => finish(json(initial)));
  expect(test).toBeEnabled();
});

it("disables testing until the catalog loads", async () => {
  let finish: (response: Response) => void = () => {};
  routeFetch({
    catalog: () => new Promise<Response>((resolve) => (finish = resolve)),
  });
  renderPage();
  const test = await screen.findByRole("button", { name: "测试" });
  expect(test).toBeDisabled();
  await act(async () =>
    finish(json({ providers: [{ id: "example", models: ["first"] }] })),
  );
  await waitFor(() => expect(test).toBeEnabled());
});
