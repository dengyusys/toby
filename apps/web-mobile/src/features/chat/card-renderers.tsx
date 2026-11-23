/**
 * Card renderers keyed by the card item's domain id; an unknown id falls back
 * to chat/ItemView.tsx. The receipt is opaque on the wire (mobile copy —
 * nothing is shared with the PC app).
 */

import type { ReactNode } from "react";
import type {
  LedgerReceiptView,
  LedgerUpdateResult,
  MemoryReceipt,
} from "@toby/contract";
import { ReceiptCard } from "@/features/ledger/ReceiptCard.tsx";
import {
  MemoryReceiptCard,
  type MemoryReceiptBatch,
} from "@/features/memory/MemoryReceiptCard.tsx";

export interface CardRendererProps {
  receipt: unknown;
}

export type CardRenderer = (props: CardRendererProps) => ReactNode;

function ledgerCard({ receipt }: CardRendererProps): ReactNode {
  return (
    <ReceiptCard receipt={receipt as LedgerReceiptView | LedgerUpdateResult} />
  );
}

function memoryCard({ receipt }: CardRendererProps): ReactNode {
  return (
    <MemoryReceiptCard
      receipt={receipt as MemoryReceipt | MemoryReceiptBatch}
    />
  );
}

const renderers = new Map<string, CardRenderer>([
  ["ledger", ledgerCard],
  ["memory", memoryCard],
]);

export function cardRendererFor(domain: string): CardRenderer | undefined {
  return renderers.get(domain);
}
