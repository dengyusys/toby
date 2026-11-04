import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, LogOut, Menu, MessageSquare } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/api.ts";
import logo from "@/assets/logo.svg";

/** Drawer slide transition length; keeps the unmount timer in sync. */
const DRAWER_TRANSITION_MS = 300;

/** Primary-route nav entries: icon + label, rendered as drawer pills. */
const NAV_ITEMS = [
  { to: "/", label: "对话", end: true, icon: MessageSquare },
  { to: "/ledger", label: "账单", end: false, icon: Calendar },
] as const;

function NavPills({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav aria-label="主导航" className="mt-2 flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, end, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? "bg-accent-soft font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground"
            }`
          }
        >
          <Icon className="size-5 shrink-0 text-foreground" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Route shell (mobile): a compact top bar whose hamburger button opens the
 * nav drawer — nearly full-screen, sliding in from the left (doubao-style);
 * a narrow scrim strip stays tappable on the right to close, as does a nav
 * pick. The logout button sits at the drawer's bottom. There is no close
 * button by design. Each page owns its scrolling — the chat fills the
 * viewport, the ledger page scrolls its column.
 */
export function AppLayout() {
  // The drawer keeps its DOM node mounted while the exit transition plays:
  // `mounted` controls presence, `shown` drives the transform/scrim states.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: () => authClient.logout(),
    onSettled: () => {
      // Reset (not remove) the cached session: the route gate still
      // observes it, so reset refetches it, sees the logged-out answer,
      // and walks the app to /login on its own.
      queryClient.resetQueries({ queryKey: ["auth", "session"] });
    },
  });

  function logout(): void {
    logoutMutation.mutate();
    closeDrawer();
  }

  function openDrawer(): void {
    setMounted(true);
  }

  function closeDrawer(): void {
    setShown(false);
    window.setTimeout(() => setMounted(false), DRAWER_TRANSITION_MS);
  }

  // Paint one frame off-screen first so the slide-in transition runs.
  useEffect(() => {
    if (!mounted) {
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b bg-card/80 px-3 backdrop-blur">
        <button
          type="button"
          aria-label="打开菜单"
          aria-expanded={mounted}
          onClick={openDrawer}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
        <img src={logo} alt="" className="size-5" />
        <span className="text-sm font-semibold tracking-tight">Toby</span>
      </header>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      {mounted && (
        <div className="fixed inset-0 z-50">
          {/* The scrim spans the viewport; the panel covers all but a
              right-hand strip, which stays tappable for closing. */}
          <button
            type="button"
            aria-label="关闭菜单"
            className={`absolute inset-0 cursor-pointer bg-black/40 transition-opacity duration-300 ease-out ${
              shown ? "opacity-100" : "opacity-0"
            }`}
            onClick={closeDrawer}
          />
          <aside
            aria-label="侧边导航"
            className={`absolute inset-y-0 left-0 flex w-[calc(100%-3rem)] flex-col bg-card p-4 shadow-2xl transition-transform duration-300 ease-out ${
              shown ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center gap-2.5 px-2 py-3">
              <img src={logo} alt="" className="size-6" />
              <span className="text-sm font-semibold tracking-tight">Toby</span>
            </div>
            <NavPills onNavigate={closeDrawer} />
            <button
              type="button"
              onClick={logout}
              disabled={logoutMutation.isPending}
              className="mt-auto flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              <LogOut className="size-[18px] shrink-0" />
              退出登录
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
