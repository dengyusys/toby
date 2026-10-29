/**
 * Chat route (primary, "/"): the conversational recording panel fills the
 * viewport right of the sidebar. Today it records into the ledger domain;
 * the unified chat of docs/features/chat.md will grow here. The ledger
 * calendar lives on its own /ledger route.
 */

import { LedgerChat } from "@/features/ledger/LedgerChat.tsx";

export function ChatPage() {
  return (
    <div className="h-full">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
        <LedgerChat />
      </div>
    </div>
  );
}
