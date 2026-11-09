/**
 * Login page: single password field against the auth domain. Shows a plain
 * notice when the deployment has no password configured (local dev); any
 * 401 elsewhere in the app routes here through the query caches.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Link } from "react-router";
import { useState } from "react";
import { ApiError } from "@toby/contract";
import { authClient } from "@/lib/api.ts";
import logo from "@/assets/logo.svg";

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
      <div className="flex min-h-dvh justify-center bg-muted p-4 sm:p-6">
        <div className="flex w-full max-w-3xl items-center justify-center rounded-3xl bg-muted px-6 py-12">
          <section className="w-full max-w-md rounded-2xl bg-card px-10 py-14 sm:px-14">
            <div className="flex flex-col items-center">
              <img src={logo} alt="" className="size-16" />
              <h1 className="mt-8 text-3xl font-semibold">登录未启用</h1>
            </div>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              本部署没有配置密码,无需登录。
            </p>
            <Link
              to="/"
              className="mt-10 inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:opacity-80"
            >
              直接进入
            </Link>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh justify-center bg-muted p-4 sm:p-6">
      <div className="flex w-full max-w-3xl items-center justify-center rounded-3xl bg-muted px-6 py-12">
        <section className="w-full max-w-md rounded-2xl bg-card px-10 py-14 sm:px-14">
          <div className="flex flex-col items-center">
            <img src={logo} alt="" className="size-16" />
            <h1 className="mt-8 text-3xl font-semibold">欢迎回来</h1>
          </div>
          <form
            className="mt-10"
            onSubmit={(event) => {
              event.preventDefault();
              loginMutation.mutate();
            }}
          >
            <div className="relative">
              <input
                id="login-password"
                aria-label="密码"
                type={showPassword ? "text" : "password"}
                required
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border-b border-foreground/40 bg-transparent px-0 py-3 pr-11 text-base outline-none focus-visible:border-foreground"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute inset-y-0 right-0 h-auto text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </Button>
            </div>
            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="mt-10 h-14 w-full rounded-xl text-base font-semibold hover:opacity-80"
            >
              {loginMutation.isPending ? "登录中…" : "登录"}
            </Button>
            {loginMutation.isError && (
              <p className="mt-2 text-sm text-destructive">
                {describeError(loginMutation.error)}
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
