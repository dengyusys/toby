/**
 * The one-time reveal of a new token's secret. The server keeps only a
 * digest, so "copy it now" is literal: once this panel closes, the secret is
 * gone for good.
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";

interface CreatedTokenPanelProps {
  name: string;
  secret: string;
  onDone: () => void;
}

export function CreatedTokenPanel({
  name,
  secret,
  onDone,
}: CreatedTokenPanelProps) {
  const secretField = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<"" | "copied" | "manual">("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopyStatus("copied");
    } catch {
      // Clipboard access needs a secure context (and permission): on a
      // plain-HTTP origin, select the text so Ctrl+C still works.
      secretField.current?.select();
      setCopyStatus("manual");
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-primary/50 bg-card p-5 sm:p-7"
    >
      <p className="text-sm font-medium">
        令牌「{name}」已创建。明文只显示这一次,请现在复制保存。
      </p>
      <input
        ref={secretField}
        aria-label="新令牌明文"
        readOnly
        value={secret}
        onFocus={(event) => event.currentTarget.select()}
        className="mt-4 w-full rounded-lg border bg-muted px-3 py-2 font-mono text-sm"
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void copy()}>
          复制
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          我已保存
        </Button>
      </div>
      {copyStatus === "copied" && (
        <p className="mt-3 text-xs text-muted-foreground">已复制到剪贴板。</p>
      )}
      {copyStatus === "manual" && (
        <p className="mt-3 text-xs text-muted-foreground">
          无法自动复制,已选中明文,请按 Ctrl+C。
        </p>
      )}
    </div>
  );
}
