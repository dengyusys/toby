/**
 * The settings shell: the page title, a tab bar of routed links, and the
 * outlet. Each tab is its own route (App.tsx), so the URL says which
 * settings are on screen — a refresh, a bookmark, or the back button all
 * keep it — and only the tab on screen asks for its data.
 */

import { NavLink, Outlet } from "react-router";

const TABS = [
  { to: "/settings/ai", label: "模型" },
  { to: "/settings/password", label: "登录密码" },
  { to: "/settings/tokens", label: "访问令牌" },
] as const;

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="mb-3 pr-12">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">
            设置
          </h1>
        </header>
        {/* The links sit one pixel over the bar's border, so the active
            tab's underline covers it instead of stacking under it. */}
        <nav aria-label="设置分区" className="mb-6 flex gap-1 border-b">
          {TABS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </div>
  );
}
