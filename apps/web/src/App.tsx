import { Route, Routes } from "react-router";
import { ChatPage } from "@/features/chat/ChatPage.tsx";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { RequireAuth } from "@/features/auth/RequireAuth.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { TraceStreamProvider } from "@/features/traces/trace-stream.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      {/* Login stands alone, outside the layout: no sidebar, no monitor —
          just a centered card on the bare background. */}
      <Route path="/login" element={<LoginPage />} />
      {/* The trace stream provider wraps the layout — not just the gated
          routes — because the monitor drawer is rendered by the layout
          itself, outside the routed outlet. One EventSource for the whole
          app session; AI runs keep flowing in on every page. */}
      <Route
        element={
          <TraceStreamProvider>
            <AppLayout />
          </TraceStreamProvider>
        }
      >
        {/* The conversation is the primary route; the ledger calendar is
            its own data view. Everything inside the layout renders only
            past the session gate. */}
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/system" element={<HealthPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
