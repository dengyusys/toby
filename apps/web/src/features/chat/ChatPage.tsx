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
