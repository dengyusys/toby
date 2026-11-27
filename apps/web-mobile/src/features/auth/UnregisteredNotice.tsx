/**
 * The mobile answer to a deployment without a password: mobile has no
 * registration page, so the visitor is pointed at the PC app. `onRetry` asks
 * the server again for when they come back registered.
 */

import logo from "@/assets/logo.svg";
import { Button } from "@/components/ui/button.tsx";

export function UnregisteredNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh justify-center bg-background p-4">
      <div className="flex w-full items-center justify-center rounded-3xl bg-muted px-4 py-12">
        <section className="w-full max-w-md rounded-2xl bg-card px-8 py-12">
          <div className="flex flex-col items-center">
            <img src={logo} alt="" className="size-16" />
            <h1 className="mt-8 text-3xl font-semibold">
              请先在电脑端完成注册
            </h1>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            第一次使用
            Toby,需要在电脑端打开并设置登录密码。设置好后回到这里登录。
          </p>
          <Button
            type="button"
            onClick={onRetry}
            className="mt-10 h-14 w-full rounded-xl text-base font-semibold hover:opacity-80 active:opacity-80"
          >
            我已设置,重新检查
          </Button>
        </section>
      </div>
    </div>
  );
}
