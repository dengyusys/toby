import { Route, Routes } from "react-router";
import { ChatPage } from "@/features/chat/ChatPage.tsx";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { RequireAuth } from "@/features/auth/RequireAuth.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/login" element={<LoginPage />} />
        {/* The conversation is the primary route; the ledger calendar is
            its own data view. Every page except /login renders only past
            the session gate. */}
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/system" element={<HealthPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
