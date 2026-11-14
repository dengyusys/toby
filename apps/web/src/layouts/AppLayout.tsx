import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  Calendar,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { authClient } from "@/lib/api.ts";
import { PreviewProvider } from "@/features/preview/preview-context.tsx";
import { PreviewOfferCard } from "@/features/preview/PreviewOfferCard.tsx";
import { PreviewPanel } from "@/features/preview/PreviewPanel.tsx";
import { MonitorPanel } from "@/features/traces/MonitorPanel.tsx";
import logo from "@/assets/logo.svg";
import { Button } from "@/components/ui/button.tsx";

/** Primary-route nav entries: icon + label, rendered as sidebar pills. */
const NAV_ITEMS = [
  { to: "/", label: "对话", end: true, icon: MessageSquare },
  { to: "/ledger", label: "账单", end: false, icon: Calendar },
  { to: "/memory", label: "记忆", end: false, icon: Brain },
  { to: "/settings", label: "设置", end: false, icon: Settings },
] as const;

/**
 * Route shell (yuanbao-style): a fixed left sidebar — brand block on top,
 * pill nav below with the active item on a flat accent fill, logout
 * pinned to the bottom — and the route outlet filling the rest, flanked
 * by the activity rail and the preview panel (inspect links open it,
 * splitting the main area like the monitor drawer does). Each page owns
 * its scrolling: the chat fills the viewport, the ledger page scrolls
 * its column.
 */
export function AppLayout() {
  const [monitorOpen, setMonitorOpen] = useState(false);
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

  return (
    <PreviewProvider>
      <div className="flex h-dvh overflow-hidden">
        <aside
          aria-label="侧边导航"
          className="flex w-[360px] shrink-0 flex-col border-r bg-muted/50 p-3 max-[1100px]:w-56 max-[767px]:w-16"
        >
          <div className="flex items-center gap-2.5 px-2 py-3 max-[767px]:justify-center max-[767px]:px-0">
            <img src={logo} alt="" className="size-6" />
            <span className="text-sm font-semibold tracking-tight max-[767px]:hidden">
              Toby
            </span>
          </div>
          <nav aria-label="主导航" className="mt-2 flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, end, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                aria-label={label}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors max-[767px]:justify-center max-[767px]:px-0 ${
                    isActive
                      ? "bg-accent-soft font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground"
                  }`
                }
              >
                <Icon className="size-5 shrink-0 text-foreground" />
                <span className="max-[767px]:hidden">{label}</span>
              </NavLink>
            ))}
          </nav>
          <Button
            type="button"
            variant="ghost"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="mt-auto h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent-soft/60 hover:text-foreground max-[767px]:justify-center max-[767px]:px-0"
          >
            <LogOut className="size-[18px] shrink-0" />
            <span className="max-[767px]:hidden">退出登录</span>
          </Button>
        </aside>
        <main className="relative flex min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-w-0 flex-1 overflow-hidden">
            <div className="relative min-w-0 flex-1 overflow-hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMonitorOpen((open) => !open)}
                aria-label={monitorOpen ? "关闭监控" : "打开 AI 调用监控"}
                title={monitorOpen ? "关闭监控" : "AI 调用监控"}
                aria-expanded={monitorOpen}
                className={`absolute right-4 top-4 z-20 rounded-lg border shadow-sm ${
                  monitorOpen
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Activity className="size-4" />
              </Button>
              <Outlet />
            </div>
            <PreviewOfferCard />
            <PreviewPanel />
          </div>
          {monitorOpen && (
            <aside
              aria-label="AI 调用监控"
              className="z-30 flex w-2/5 shrink-0 flex-col border-l bg-card max-[767px]:absolute max-[767px]:inset-0 max-[767px]:w-auto"
            >
              <MonitorPanel onClose={() => setMonitorOpen(false)} />
            </aside>
          )}
        </main>
      </div>
    </PreviewProvider>
  );
}
