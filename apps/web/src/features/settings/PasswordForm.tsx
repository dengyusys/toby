/**
 * The change-password card on the settings page. A successful change ends
 * every session — the caller's included — so it walks the app to the login
 * page instead of waiting for the next request's 401.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { authClient } from "@/lib/api.ts";
import { FieldError } from "./FieldError.tsx";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "当前密码不对";
      default:
        return error.message;
    }
  }
  return "修改失败,请稍后重试";
}

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === currentPassword) {
      setError("新密码不能与当前密码相同");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await authClient.changePassword(currentPassword, newPassword);
      // Every session is gone; drop the cached one so nothing bounces back.
      queryClient.removeQueries({ queryKey: ["auth", "session"] });
      window.location.hash = "#/login";
    } catch (thrown) {
      setError(describeError(thrown));
    } finally {
      // The typed passwords never outlive the attempt, success or failure.
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setSaving(false);
    }
  }

  const ready = !!currentPassword && !!newPassword && !!confirm;

  // The tab's name is in the tab bar; the heading keeps the page outline for
  // screen readers.
  return (
    <>
      <h2 className="sr-only">登录密码</h2>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        className="rounded-xl border bg-card shadow-sm"
      >
        <fieldset disabled={saving} className="min-w-0 space-y-6 p-5 sm:p-7">
          <legend className="sr-only">登录密码</legend>
          <div>
            <Label htmlFor="current-password" className="text-sm font-medium">
              当前密码
            </Label>
            <Input
              id="current-password"
              type="password"
              className="mt-2 h-11 rounded-lg"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-password" className="text-sm font-medium">
              新密码
            </Label>
            <Input
              id="new-password"
              type="password"
              className="mt-2 h-11 rounded-lg"
              value={newPassword}
              autoComplete="new-password"
              aria-invalid={!!error}
              aria-describedby="password-error"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="confirm-password" className="text-sm font-medium">
              确认新密码
            </Label>
            <Input
              id="confirm-password"
              type="password"
              className="mt-2 h-11 rounded-lg"
              value={confirm}
              autoComplete="new-password"
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          <FieldError id="password-error" message={error} />
        </fieldset>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-4 sm:px-7">
          <Button type="submit" disabled={saving || !ready}>
            {saving ? "修改中…" : "修改密码"}
          </Button>
        </div>
      </form>
    </>
  );
}
