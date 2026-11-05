/**
 * Chat route (primary, "/"): the unified conversation fills the viewport
 * right of the sidebar — one sentence in, an ordered item stream out
 * (docs/features/chat.md). The ledger calendar lives on its own /ledger
 * route; inspect links open the preview panel instead of navigating.
 */

import { ChatView } from "./ChatView.tsx";

export function ChatPage() {
  return (
    <div className="h-full">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
        <ChatView />
      </div>
    </div>
  );
}
