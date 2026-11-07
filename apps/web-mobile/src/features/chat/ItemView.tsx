/**
 * One chat item, in stream order (mobile copy): transcript messages
 * rendered from the pi-ai verbatim shapes (thinking collapsible, tool
 * calls paired to their results by toolCallId, honest 进行中 for
 * unpaired calls), the receipt card, notices, and inspect chips that
 * open the full-screen preview panel. Nothing is shared with the PC app.
 */

import type {
  ChatItem,
  PiAssistantMessage,
  PiToolResultMessage,
} from "@toby/contract";
import { ExternalLink } from "lucide-react";
import { cardRendererFor } from "./card-renderers.tsx";
import { usePreview } from "@/features/preview/preview-context.tsx";

const MONO = "whitespace-pre-wrap break-all font-mono text-xs leading-relaxed";

interface ItemViewProps {
  item: ChatItem;
  nowMs: number;
  /** Unpaired tool calls render as 进行中 (structural in-progress state). */
  pendingToolCallIds: ReadonlySet<string>;
  revertPending: boolean;
  revertError: Error | null;
  onRevert: (proposalId: string) => void;
  onDismissCard: () => void;
}

export function ItemView({
  item,
  nowMs,
  pendingToolCallIds,
  revertPending,
  revertError,
  onRevert,
  onDismissCard,
}: ItemViewProps) {
  if ("type" in item) {
    if (item.type === "proposal_card") {
      const render = cardRendererFor(item.domain);
      if (render !== undefined) {
        return (
          <>
            {render({
              receipt: item.receipt,
              nowMs,
              revertPending,
              revertError,
              onRevert,
              onDismiss: onDismissCard,
            })}
          </>
        );
      }
      // An unknown domain id (a newer server than this build) degrades
      // to a neutral shell instead of a crash.
      return <UnsupportedCard onDismiss={onDismissCard} />;
    }
    if (item.type === "inspect_link") {
      return <InspectChip item={item} />;
    }
    return (
      <p className="px-1 text-sm leading-relaxed text-muted-foreground">
        {item.text}
      </p>
    );
  }
  switch (item.role) {
    case "user":
      return <UserItem item={item} />;
    case "assistant":
      return (
        <AssistantItem item={item} pendingToolCallIds={pendingToolCallIds} />
      );
    case "toolResult":
      return <ToolResultItem item={item} />;
    default:
      return <pre className={MONO}>{JSON.stringify(item, null, 2)}</pre>;
  }
}

function UserItem({ item }: { item: ChatItem }) {
  const content = (item as { content?: unknown }).content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((block) =>
              (block as { type?: string; text?: string }).type === "text"
                ? (block as { text?: string }).text
                : "[图片]",
            )
            .join("\n")
        : "";
  return (
    <div className="flex justify-end">
      <div className="max-w-[86%] rounded-lg rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </div>
    </div>
  );
}

function AssistantItem({
  item,
  pendingToolCallIds,
}: {
  item: PiAssistantMessage;
  pendingToolCallIds: ReadonlySet<string>;
}) {
  const hasText = item.content.some((block) => block.type === "text");
  return (
    <div className="flex flex-col gap-2">
      {item.content.map((block, index) => {
        if (block.type === "thinking") {
          return block.thinking.length > 0 ? (
            <details key={`thinking-${index}`}>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                思考过程
              </summary>
              <pre className={`${MONO} mt-1`}>{block.thinking}</pre>
            </details>
          ) : null;
        }
        if (block.type === "toolCall") {
          const pending = pendingToolCallIds.has(block.id);
          return (
            <div
              key={block.id}
              className="rounded-lg border bg-muted/40 p-3 text-xs"
            >
              <p className="font-mono font-medium">
                调用工具:{block.name}
                {pending && (
                  <span className="ml-2 font-sans text-muted-foreground">
                    进行中…
                  </span>
                )}
              </p>
              {Object.keys(block.arguments).length > 0 && (
                <pre className={`${MONO} mt-1`}>
                  {JSON.stringify(block.arguments, null, 2)}
                </pre>
              )}
            </div>
          );
        }
        return (
          <p
            key={`text-${index}`}
            className="whitespace-pre-wrap px-1 text-sm leading-relaxed text-foreground"
          >
            {block.text}
          </p>
        );
      })}
      {!hasText && item.content.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">(空回复)</p>
      )}
    </div>
  );
}

function ToolResultItem({ item }: { item: PiToolResultMessage }) {
  const text = item.content
    .map((block) => (block.type === "text" ? block.text : "[图片]"))
    .join("\n");
  return (
    <div
      className={`rounded-lg border p-3 ${item.isError ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}
    >
      <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
        工具结果:{item.toolName}
      </p>
      <pre className={`${MONO} ${item.isError ? "text-destructive" : ""}`}>
        {text}
      </pre>
    </div>
  );
}

function InspectChip({
  item,
}: {
  item: Extract<ChatItem, { type: "inspect_link" }>;
}) {
  const preview = usePreview();
  return (
    <button
      type="button"
      onClick={() => preview.open(item.target)}
      className="inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs text-muted-foreground active:bg-accent-soft active:text-foreground"
    >
      <ExternalLink className="size-3" />
      查看 {item.label}
    </button>
  );
}

/** A card whose domain this build cannot render: degrade, don't crash. */
function UnsupportedCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      <p>这是一张本版本暂不支持的卡片。</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 rounded-md border px-2 py-1 active:bg-accent-soft"
      >
        知道了
      </button>
    </div>
  );
}
