import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AiTestResult } from "@toby/contract";
import { SettingsForm } from "./SettingsForm.tsx";

const initial = {
  model: { value: "zai/glm-4.7", source: "db" as const },
  providers: [],
};
const catalog = { providers: [{ id: "zai", models: ["glm-4.7"] }] };
const ok: AiTestResult = {
  stage: "ok",
  model: "zai/glm-4.7",
  latencyMs: 123,
  reply: "你好",
  message: null,
};

function mount(hasCatalog = true) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SettingsForm
        initial={initial}
        catalog={hasCatalog ? catalog : undefined}
        catalogPending={!hasCatalog}
        catalogFailed={false}
        catalogFetching={!hasCatalog}
        retryCatalog={() => {}}
      />
    </QueryClientProvider>,
  );
}

function stubProbe(result: AiTestResult | Promise<AiTestResult>) {
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(await result), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return requests;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("tests an unsaved key without saving, and clears the result on edit", async () => {
  const requests = stubProbe(ok);
  mount();
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "test-only-credential" },
  });
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(
    await screen.findByText("连接成功 · 123ms「你好」"),
  ).toBeInTheDocument();
  expect(requests).toEqual([
    { credentials: [{ provider: "zai", apiKey: "test-only-credential" }] },
  ]);
  expect(screen.getByLabelText("API key")).toHaveValue("test-only-credential");
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "replacement" },
  });
  expect(screen.queryByText(/连接成功/)).not.toBeInTheDocument();
});

it("tests model reset with the same null overlay used for saving", async () => {
  const requests = stubProbe({ ...ok, stage: "unconfigured", reply: null });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "恢复环境配置" }));
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(await screen.findByText("尚未配置模型")).toBeInTheDocument();
  expect(requests).toEqual([{ model: null }]);
});

it.each([
  ["auth", "密钥无效或未配置"],
  ["timeout", "请求超时"],
  ["invalid-model", "模型不可用，请重新选择"],
  ["request-failed", "请求失败：服务暂不可用"],
] as const)("shows %s probe failures", async (stage, message) => {
  stubProbe({ ...ok, stage, message: "服务暂不可用" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(await screen.findByText(message)).toBeInTheDocument();
});

it("disables fields and both actions while testing", async () => {
  let resolve!: (result: AiTestResult) => void;
  stubProbe(
    new Promise<AiTestResult>((done) => {
      resolve = done;
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(screen.getByText("正在测试…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "测试" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByLabelText("API key")).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "供应商" })).toBeDisabled();
  resolve(ok);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "测试" })).toBeEnabled(),
  );
});

it("disables testing until the catalog loads", () => {
  mount(false);
  expect(screen.getByRole("button", { name: "测试" })).toBeDisabled();
});

it("maps thrown validation errors inline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errorCode: "SETTINGS_INVALID_CREDENTIAL",
            message: "invalid",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(
    await screen.findByText("密钥格式无效，请重新输入。"),
  ).toBeInTheDocument();
});

it("disables testing during save and clears the submitted key", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  mount();
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "test-only-credential" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("button", { name: "测试" })).toBeDisabled();
  expect(screen.getByLabelText("API key")).toHaveValue("");
  finish(
    new Response(JSON.stringify(initial), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  expect(await screen.findByText("已保存")).toBeInTheDocument();
});
