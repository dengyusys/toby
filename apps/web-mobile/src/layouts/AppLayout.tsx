import { Outlet } from "react-router";
import logo from "@/assets/logo.svg";

/** Route shell: compact brand header plus the full-width page outlet. */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-4">
          <img src={logo} alt="" className="size-5" />
          <span className="text-sm font-semibold tracking-tight">Toby</span>
        </div>
      </header>
      <main className="flex-1 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
    </div>
  );
}
