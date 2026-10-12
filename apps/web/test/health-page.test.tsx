/**
 * Health page render smoke: with fetch stubbed to the system endpoints, the
 * page resolves the health status and the server info fields.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HealthPage } from "../src/features/system/HealthPage.tsx";

const HEALTH = { status: "ok" } as const;
const INFO = {
  name: "toby",
  version: "0.0.0",
  node: "v22.23.2",
  started_at: "2026-10-13T00:00:00.000Z",
  uptime_seconds: 42,
} as const;

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HealthPage />
    </QueryClientProvider>,
  );
}

it("renders the health status from the system endpoint", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        fakeResponse(String(input).endsWith("/health") ? HEALTH : INFO),
      ),
    ),
  );

  renderPage();

  expect(await screen.findByText("ok")).toBeInTheDocument();
  expect(await screen.findByText("toby")).toBeInTheDocument();
  expect(screen.getByText("v22.23.2")).toBeInTheDocument();
});

it("renders the unreachable state when the endpoints fail", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }),
          ),
      } as Response),
    ),
  );

  renderPage();

  expect(await screen.findByText("unreachable: boom")).toBeInTheDocument();
  expect(screen.getByText("boom")).toBeInTheDocument();
});
