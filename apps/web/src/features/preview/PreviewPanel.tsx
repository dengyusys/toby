/**
 * The preview panel chrome: the layout's right panel that inspect links
 * and the activity rail open. One target id resolves to one preview —
 * the vocabulary grows as domains land.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { ledgerMonthOf, usePreview } from "./preview-context.tsx";
import { LedgerMonthPreview } from "./LedgerMonthPreview.tsx";

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
    <p className="px-5 py-4 text-sm text-muted-foreground">
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
    <aside className="z-30 flex w-2/5 shrink-0 flex-col border-l bg-card max-[767px]:absolute max-[767px]:inset-0">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="text-sm font-medium">{panelTitle(target)}</h2>
        <button
          type="button"
          aria-label="关闭预览"
          onClick={close}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{panelBody(target)}</div>
    </aside>
  );
}
