/**
 * Chat route (primary, "/"): the unified conversation fills the viewport
 * below the header (the nav drawer lives in the layout) — one sentence
 * in, an ordered item stream out (docs/features/chat.md). The ledger
 * calendar lives on its own /ledger route; inspect links open the
 * full-screen preview panel instead of navigating.
 */

import { ChatView } from "./ChatView.tsx";

export function ChatPage() {
  // The bottom padding keeps the composer above the home-indicator area.
  return (
    <div className="h-full">
      <div className="flex h-full flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <ChatView />
      </div>
    </div>
  );
}
