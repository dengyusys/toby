/**
 * Memory receipt card: one landed change, or the routed batch that also
 * carries verbatim listed lines. Before/after are MEMORY.md's exact lines.
 * The compact form is reused for inline page and ledger confirmations.
 */

import type { MemoryReceipt } from "@toby/contract";

export interface MemoryReceiptBatch {
  receipts: MemoryReceipt[];
  listed?: string[];
}

export type MemoryReceiptWire = MemoryReceipt | MemoryReceiptBatch;

interface MemoryReceiptCardProps {
  receipt: MemoryReceiptWire;
  compact?: boolean;
}

const ACTION_HEADINGS: Record<MemoryReceipt["action"], string> = {
  remembered: "已记住",
  updated: "已更新",
  forgot: "已清理",
};

function ReceiptDiff({ receipt }: { receipt: MemoryReceipt }) {
  if (receipt.before !== undefined && receipt.after !== undefined) {
    return (
      <p className="mt-2 break-words font-mono text-xs leading-6">
        <span className="text-muted-foreground">{receipt.before}</span>
        <span className="mx-2 text-muted-foreground" aria-hidden="true">
          →
        </span>
        <span className="font-semibold text-foreground">{receipt.after}</span>
      </p>
    );
  }
  const line = receipt.after ?? receipt.before;
  if (line === undefined) return null;
  return (
    <p
      className={`mt-2 break-words font-mono text-xs leading-6 ${
        receipt.action === "forgot"
          ? "text-muted-foreground"
          : "font-medium text-foreground"
      }`}
    >
      {line}
    </p>
  );
}

interface MemoryReceiptLinesProps {
  receipts: readonly MemoryReceipt[];
  compact?: boolean;
}

/** Just the receipt lines, also used inside the ledger card's sidecar. */
export function MemoryReceiptLines({
  receipts,
  compact = false,
}: MemoryReceiptLinesProps) {
  return receipts.map((item, index) => (
    <div
      key={`${item.created_at}-${index}`}
      className={index > 0 ? "mt-3 border-t border-border pt-3" : ""}
    >
      <div className="flex items-center gap-2">
        <h2
          className={compact ? "text-sm font-medium" : "text-base font-medium"}
        >
          {ACTION_HEADINGS[item.action]}
        </h2>
        <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
          {item.type}
        </span>
      </div>
      <ReceiptDiff receipt={item} />
    </div>
  ));
}

export function MemoryReceiptCard({
  receipt,
  compact = false,
}: MemoryReceiptCardProps) {
  const receipts = "receipts" in receipt ? receipt.receipts : [receipt];
  const listed = "receipts" in receipt ? receipt.listed : undefined;

  return (
    <section
      aria-label="记忆回执"
      className={
        compact
          ? "rounded-lg border border-border bg-card px-3 py-2.5"
          : "rounded-xl border bg-card p-5 shadow-sm"
      }
    >
      <MemoryReceiptLines receipts={receipts} compact={compact} />

      {listed !== undefined && (
        <div
          className={
            receipts.length > 0 ? "mt-4 border-t border-border pt-3" : ""
          }
        >
          <h2
            className={
              compact ? "text-sm font-medium" : "text-base font-medium"
            }
          >
            已逐条列出
          </h2>
          {listed.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">没有相关记忆</p>
          ) : (
            <ul className="mt-2 space-y-1 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs leading-5">
              {listed.map((line, index) => (
                <li
                  key={`${line}-${index}`}
                  className="whitespace-pre-wrap break-words"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {receipts.length === 0 && listed === undefined && (
        <p className="text-sm text-muted-foreground">没有相关记忆</p>
      )}
    </section>
  );
}
