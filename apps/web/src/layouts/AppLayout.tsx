import { NavLink, Outlet } from "react-router";
import logo from "@/assets/logo.svg";

/** Primary-route nav entries: icon + label, rendered as sidebar pills. */
const NAV_ITEMS = [
  { to: "/", label: "对话", end: true, icon: ChatIcon },
  { to: "/ledger", label: "账单", end: false, icon: CalendarIcon },
] as const;

/**
 * Route shell (yuanbao-style): a fixed left sidebar — brand block on top,
 * pill nav below with the active item lifted onto a white card — and the
 * route outlet filling the rest. Each page owns its scrolling: the chat
 * fills the viewport, the ledger page scrolls its column.
 */
export function AppLayout() {
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        aria-label="侧边导航"
        className="flex w-56 shrink-0 flex-col border-r bg-muted/50 p-3 max-[767px]:w-16"
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
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors max-[767px]:justify-center max-[767px]:px-0 ${
                  isActive
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                }`
              }
            >
              <Icon className="size-[18px] shrink-0" />
              <span className="max-[767px]:hidden">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

/** Thin outline chat bubble (lucide message-square geometry). */
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** Thin outline calendar (the ledger is a month calendar). */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
