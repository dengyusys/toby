import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { ApiError } from "@toby/contract";
import { App } from "./App.tsx";
import "./index.css";

// Any 401 anywhere in the app routes to the login page (docs/features/auth.md);
// proposal confirmations are never auto-retried.
function redirectToLoginOn401(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    window.location.hash = "#/login";
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: redirectToLoginOn401 }),
  mutationCache: new MutationCache({ onError: redirectToLoginOn401 }),
});

const root = document.querySelector("#root");
if (!root) {
  throw new Error("missing #root element in index.html");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
