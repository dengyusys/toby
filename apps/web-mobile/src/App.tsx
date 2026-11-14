import { Route, Routes } from "react-router";
import { ChatPage } from "@/features/chat/ChatPage.tsx";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { MemoryPage } from "@/features/memory/MemoryPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { RequireAuth } from "@/features/auth/RequireAuth.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      {/* Login stands alone, outside the layout: no top bar, no drawer —
          just a centered card on the bare background. */}
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        {/* The conversation is the primary route; the ledger calendar is
            its own data view (same split as the PC app). Everything inside
            the layout renders only past the session gate. */}
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/system" element={<HealthPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
