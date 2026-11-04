/**
 * Login page: single password field against the auth domain. Shows a plain
 * notice when the deployment has no password configured (local dev); any
 * 401 elsewhere in the app routes here through the query caches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { ApiError } from "@toby/contract";
import { authClient } from "@/lib/api.ts";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "密码不对";
      case "AUTH_DISABLED":
        return "登录未配置";
      default:
        return error.message;
    }
  }
  return "请求失败,请稍后重试";
}

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => authClient.session(),
  });
  const loginMutation = useMutation({
    mutationFn: () => authClient.login(password),
    onSuccess: () => {
      setPassword("");
      // The cached session still says unauthenticated; drop it or the
      // route gate bounces the fresh session back here.
      queryClient.removeQueries({ queryKey: ["auth", "session"] });
      window.location.hash = "#/";
    },
  });

  if (sessionQuery.data && !sessionQuery.data.enabled) {
    return (
      <section className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-medium">登录未启用</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          本部署没有配置密码,无需登录。
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          直接进入
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-medium">登录 Toby</h2>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          loginMutation.mutate();
        }}
      >
        <div>
          <label
            htmlFor="login-password"
            className="block text-xs font-medium text-muted-foreground"
          >
            密码
          </label>
          <div className="relative mt-1.5">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg bg-background px-3 py-2 pr-10 text-sm shadow-[0_1px_2px_rgba(15,17,21,0.06),0_4px_12px_rgba(15,17,21,0.06)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <button
          type="submit"
          disabled={loginMutation.isPending || password === ""}
          className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {loginMutation.isPending ? "登录中…" : "登录"}
        </button>
        {loginMutation.isError && (
          <p className="mt-2 text-sm text-destructive">
            {describeError(loginMutation.error)}
          </p>
        )}
      </form>
    </section>
  );
}
