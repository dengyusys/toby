import { Outlet } from "react-router";
import logo from "@/assets/logo.svg";

/** Route shell: brand header plus the centered page outlet. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-2.5 px-6">
          <img src={logo} alt="" className="size-6" />
          <span className="text-sm font-semibold tracking-tight">Toby</span>
        </div>
      </header>
      {/* Wide enough for the ledger page's calendar + day-panel grid. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <Outlet />
      </main>
    </div>
  );
}
