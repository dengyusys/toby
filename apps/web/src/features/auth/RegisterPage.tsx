/**
 * Registration page: the one-time first-run password setup. It exists only
 * while the deployment has no password — the server answers
 * REGISTRATION_CLOSED once its startup window has passed and
 * ALREADY_REGISTERED once a password exists — so every other session state
 * is routed away from here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Navigate } from "react-router";
import { useState } from "react";
import { ApiError } from "@toby/contract";
import { authClient } from "@/lib/api.ts";
import logo from "@/assets/logo.svg";
import { Button } from "@/components/ui/button.tsx";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "REGISTRATION_CLOSED":
        return "设置时间已过,请重启 Toby 服务后刷新本页";
      default:
        return error.message;
    }
  }
  return "请求失败,请稍后重试";
}

export function RegisterPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [registeredElsewhere, setRegisteredElsewhere] = useState(false);
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => authClient.session(),
  });
  const registerMutation = useMutation({
    mutationFn: () => authClient.register(password),
    onSuccess: () => {
      // The cached session still says unregistered; drop it or the route
      // gate bounces the fresh session back here.
      queryClient.removeQueries({ queryKey: ["auth", "session"] });
      window.location.hash = "#/";
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "ALREADY_REGISTERED") {
        // Set from another tab in the meantime: drop the stale answer so
        // the login page does not bounce straight back here.
        queryClient.removeQueries({ queryKey: ["auth", "session"] });
        setRegisteredElsewhere(true);
      }
    },
  });

  if (registeredElsewhere) {
    return <Navigate to="/login" replace />;
  }
  if (sessionQuery.data?.state === "authenticated") {
    return <Navigate to="/" replace />;
  }
  if (sessionQuery.data?.state === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  function submit() {
    if (password !== confirm) {
      setFormError("两次输入的密码不一致");
      return;
    }
    setFormError("");
    registerMutation.mutate();
  }

  const inputClassName =
    "w-full border-b border-foreground/40 bg-transparent px-0 py-3 text-base outline-none focus-visible:border-foreground";

  return (
    <div className="flex min-h-dvh justify-center bg-muted p-4 sm:p-6">
      <div className="flex w-full max-w-3xl items-center justify-center rounded-3xl bg-muted px-6 py-12">
        <section className="w-full max-w-md rounded-2xl bg-card px-10 py-14 sm:px-14">
          <div className="flex flex-col items-center">
            <img src={logo} alt="" className="size-16" />
            <h1 className="mt-8 text-3xl font-semibold">设置密码</h1>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            第一次使用,请设置登录密码。这个页面只会出现这一次。
          </p>
          <form
            className="mt-10"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="relative">
              <input
                id="register-password"
                aria-label="密码"
                type={showPassword ? "text" : "password"}
                required
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${inputClassName} pr-11`}
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
            <input
              id="register-confirm"
              aria-label="确认密码"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={`${inputClassName} mt-6`}
            />
            <Button
              type="submit"
              disabled={registerMutation.isPending}
              className="mt-10 h-14 w-full rounded-xl text-base font-semibold hover:opacity-80"
            >
              {registerMutation.isPending ? "设置中…" : "注册"}
            </Button>
            {formError && (
              <p className="mt-2 text-sm text-destructive">{formError}</p>
            )}
            {registerMutation.isError && (
              <p className="mt-2 text-sm text-destructive">
                {describeError(registerMutation.error)}
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
