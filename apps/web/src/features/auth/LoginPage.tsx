/**
 * Login page: single password field against the auth domain. Shows a plain
 * notice when the deployment has no password configured (local dev); any
 * 401 elsewhere in the app routes here through the query caches.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useState } from "react";
import { ApiError } from "@toby/contract";
import { authClient } from "@/lib/api.ts";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "密码不对";
      case "RATE_LIMITED":
        return "尝试太频繁,请稍后再试";
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
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => authClient.session(),
  });
  const loginMutation = useMutation({
    mutationFn: () => authClient.login(password),
    onSuccess: () => {
      setPassword("");
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
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            密码
          </span>
          <input
            type="password"
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
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
