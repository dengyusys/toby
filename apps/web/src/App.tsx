import { Route, Routes } from "react-router";
import { LedgerPage } from "@/features/ledger/LedgerPage.tsx";
import { LoginPage } from "@/features/auth/LoginPage.tsx";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<LedgerPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/system" element={<HealthPage />} />
      </Route>
    </Routes>
  );
}
