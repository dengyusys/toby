/**
 * Card renderers keyed by the card item's domain id (mobile copy;
 * docs/decisions/chat-domain-capabilities.md): the receipt is opaque on
 * the wire, and each registered renderer narrows it with its domain's own
 * client types. A domain landing adds one row here — chat-client types
 * never change. An unknown domain id renders the neutral shell below, so
 * an older build against a newer server degrades instead of crashing.
 * Nothing is shared with the PC app.
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
