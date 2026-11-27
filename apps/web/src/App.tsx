import { Navigate, Route, Routes } from "react-router";
import { ChatPage } from "@/features/chat/ChatPage.tsx";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { MemoryPage } from "@/features/memory/MemoryPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { RegisterPage } from "@/features/auth/RegisterPage.tsx";
import { RequireAuth } from "@/features/auth/RequireAuth.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AccessTokensSection } from "@/features/settings/AccessTokensSection.tsx";
import { AiSettingsTab } from "@/features/settings/AiSettingsTab.tsx";
import { PasswordForm } from "@/features/settings/PasswordForm.tsx";
import { SettingsPage } from "@/features/settings/SettingsPage.tsx";
import { TraceStreamProvider } from "@/features/traces/trace-stream.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      {/* Login and the one-time registration stand alone, outside the
          layout: no sidebar, no monitor — just a centered card on the bare
          background. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/system" element={<HealthPage />} />
          {/* Settings is a tabbed page and each tab is a route: the URL says
              which tab is on screen, and only that tab loads its data. */}
          <Route path="/settings" element={<SettingsPage />}>
            <Route index element={<Navigate to="/settings/ai" replace />} />
            <Route path="ai" element={<AiSettingsTab />} />
            <Route path="password" element={<PasswordForm />} />
            <Route path="tokens" element={<AccessTokensSection />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
