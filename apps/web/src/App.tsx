import { Route, Routes } from "react-router";
import { HealthPage } from "@/features/system/HealthPage.tsx";
import { AppLayout } from "@/layouts/AppLayout.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HealthPage />} />
      </Route>
    </Routes>
  );
}
