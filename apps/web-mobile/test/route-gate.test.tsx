/**
 * Session gate: entering a protected route without a session lands on the
 * login page; a valid session and a passwordless deployment render the page.
 */

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { RequireAuth } from "../src/features/auth/RequireAuth.tsx";

function routeSession(session: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

function renderGate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>chat page</div>} />
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

it("redirects sessionless visitors to the login page", async () => {
  routeSession({ enabled: true, authenticated: false });
  renderGate();

  expect(await screen.findByText("login page")).toBeInTheDocument();
  expect(screen.queryByText("chat page")).not.toBeInTheDocument();
});

it("renders the page for a valid session", async () => {
  routeSession({ enabled: true, authenticated: true });
  renderGate();

  expect(await screen.findByText("chat page")).toBeInTheDocument();
  expect(screen.queryByText("login page")).not.toBeInTheDocument();
});

it("renders the page when authentication is disabled", async () => {
  routeSession({ enabled: false, authenticated: false });
  renderGate();

  expect(await screen.findByText("chat page")).toBeInTheDocument();
  expect(screen.queryByText("login page")).not.toBeInTheDocument();
});
