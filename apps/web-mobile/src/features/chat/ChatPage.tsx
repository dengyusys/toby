/**
 * Chat route ("/"): the conversation fills the space below the layout's top
 * bar; inspect chips open the full-screen preview panel.
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
