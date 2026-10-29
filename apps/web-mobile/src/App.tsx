import { Route, Routes } from "react-router";
import { ChatPage } from "@/features/chat/ChatPage.tsx";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* The conversation is the primary route; the ledger calendar is
            its own data view (same split as the PC app). */}
        <Route path="/" element={<ChatPage />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/system" element={<HealthPage />} />
      </Route>
    </Routes>
  );
}
