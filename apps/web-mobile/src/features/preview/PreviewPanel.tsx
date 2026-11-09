/**
 * The preview panel (mobile): a full-screen overlay the chat's inspect
 * chips open — one target id resolves to one preview, the vocabulary
 * grows as domains land. Nothing is shared with the PC app.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { ledgerMonthOf, usePreview } from "./preview-context.tsx";
import { LedgerMonthPreview } from "./LedgerMonthPreview.tsx";
import { Button } from "@/components/ui/button.tsx";

function panelTitle(target: string): string {
  const month = ledgerMonthOf(target);
  return month
    ? `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月账单`
    : target;
}

function panelBody(target: string): ReactNode {
  const month = ledgerMonthOf(target);
  if (month !== null) {
    return <LedgerMonthPreview month={month} />;
  }
  return (
    <p className="px-4 py-4 text-sm text-muted-foreground">
      还不认识这个预览目标:{target}
    </p>
  );
}

export function PreviewPanel() {
  const { target, close } = usePreview();
  if (target === null) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-3">
        <h2 className="text-sm font-medium">{panelTitle(target)}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-lg text-muted-foreground active:bg-accent"
          aria-label="关闭预览"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {panelBody(target)}
      </div>
    </div>
  );
}
