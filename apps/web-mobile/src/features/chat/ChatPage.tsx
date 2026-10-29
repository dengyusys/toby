/**
 * Chat route (primary, "/"): the conversational recording panel fills the
 * viewport below the header (the nav drawer lives in the layout). Today it
 * records into the ledger domain; the unified chat of docs/features/chat.md
 * will grow here. The ledger calendar lives on its own /ledger route.
 */

import { LedgerChat } from "@/features/ledger/LedgerChat.tsx";

export function ChatPage() {
  // The bottom padding keeps the composer above the home-indicator area.
  return (
    <div className="h-full">
      <div className="flex h-full flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <LedgerChat />
      </div>
    </div>
  );
}
