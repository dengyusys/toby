/**
 * Receipt card (回执卡): a write that has already landed — the batch was
 * recorded the moment the sentence was sent. Shows the entries with the
 * multi-entry total. An update receipt (AI correction) renders as the
 * before→after diff of what changed. Recovery is writing again or backup.
 */

import type {
  LedgerEntry,
  LedgerReceiptView,
  LedgerUpdateResult,
} from "@toby/contract";
import { formatCents } from "./ledger-view.ts";

interface ReceiptCardProps {
  receipt: LedgerReceiptView | LedgerUpdateResult;
}

/** One field as card copy: dates as-is, cents as money, blanks as —. */
function fieldValue(entry: LedgerEntry, field: keyof LedgerEntry): string {
  if (field === "amount") {
    return `¥${formatCents(entry.amount)}`;
  }
  if (field === "type") {
    return entry.type === "income" ? "收入" : "支出";
  }
  const value = entry[field];
  return value === "" ? "—" : value;
}

const EDITABLE_FIELDS: readonly (keyof LedgerEntry)[] = [
  "date",
  "type",
  "category",
  "amount",
  "note",
];

const FIELD_LABELS: Record<keyof LedgerEntry, string> = {
  date: "日期",
  type: "类型",
  category: "分类",
  amount: "金额",
  note: "备注",
};

function UpdatedCard({ result }: { result: LedgerUpdateResult }) {
  const changed = EDITABLE_FIELDS.filter(
    (field) => result.before[field] !== result.after[field],
  );
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-base font-medium">已修改</h2>
      <ul className="mt-3 divide-y">
        {changed.map((field) => (
          <li
            key={field}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <p className="text-xs text-muted-foreground">
              {FIELD_LABELS[field]}
            </p>
            <p className="text-sm tabular-nums">
              {fieldValue(result.before, field)}
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="font-medium">
                {fieldValue(result.after, field)}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReceiptCard({ receipt }: ReceiptCardProps) {
  if ("status" in receipt) {
    return <UpdatedCard result={receipt} />;
  }
  const entries = receipt.entries;
  const totalCents = entries.reduce(
    (sum, entry) =>
      sum + (entry.type === "income" ? entry.amount : -entry.amount),
    0,
  );

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-base font-medium">已记入</h2>
      <ul className="mt-3 divide-y">
        {entries.map((entry, index) => (
          <li
            key={`${entry.date}-${index}`}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div>
              <p className="text-sm">
                {entry.date} · {entry.type === "expense" ? "支出" : "收入"}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.category}
                {entry.note ? ` · ${entry.note}` : ""}
              </p>
            </div>
            <p
              className={`text-sm font-medium tabular-nums ${entry.type === "income" ? "text-primary" : ""}`}
            >
              {entry.type === "income" ? "+" : "-"}¥{formatCents(entry.amount)}
            </p>
          </li>
        ))}
      </ul>
      {entries.length > 1 && (
        <p className="mt-2 text-right text-xs text-muted-foreground tabular-nums">
          共 {entries.length} 笔 · 合计 {totalCents < 0 ? "-" : ""}¥
          {formatCents(Math.abs(totalCents))}
        </p>
      )}
    </section>
  );
}
