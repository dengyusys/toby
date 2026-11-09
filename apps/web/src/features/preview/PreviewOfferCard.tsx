/**
 * The pushed preview cards: when a chat turn makes something viewable, a
 * card floats top-right offering to open the preview drawer — nothing
 * persistent, nothing pre-declared; opening (or dismissing) removes it.
 */

import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { usePreview } from "./preview-context.tsx";

export function PreviewOfferCard() {
  const { offers, open, dismiss } = usePreview();
  if (offers.length === 0) {
    return null;
  }
  return (
    <div className="absolute right-4 top-16 z-20 flex w-64 flex-col gap-2">
      {offers.map((offer) => (
        <div
          key={offer.target}
          className="rounded-xl border bg-card p-3"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">可以看</p>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-m-1 shrink-0"
              aria-label={`关闭 ${offer.label} 提示`}
              onClick={() => dismiss(offer.target)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => open(offer.target)}
            className="mt-1 w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left"
          >
            <span className="font-medium">{offer.label}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </div>
      ))}
    </div>
  );
}
