/**
 * The preview-panel context: chat inspect links and pushed preview cards
 * open domain previews in the layout's right panel by target id —
 * "ledger:YYYY-MM" today, one vocabulary per domain as domains land.
 * There is no persistent rail: a card is pushed only when something
 * became viewable, and opening (or dismissing) it removes it.
 */

import { createContext, useContext, useMemo, useState } from "react";

export interface PreviewOffer {
  readonly target: string;
  readonly label: string;
}

export interface PreviewState {
  /** The open panel's target id, or null when closed. */
  target: string | null;
  open: (target: string) => void;
  close: () => void;
  /** Pushed cards, newest first, deduped by target, capped. */
  offers: readonly PreviewOffer[];
  /** Something became viewable: push (or refresh) its card. */
  offer: (offer: PreviewOffer) => void;
  /** Drop one pushed card without opening the panel. */
  dismiss: (target: string) => void;
}

const MAX_OFFERS = 3;

const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<string | null>(null);
  const [offers, setOffers] = useState<PreviewOffer[]>([]);

  const value = useMemo<PreviewState>(
    () => ({
      target,
      open: (openTarget) => {
        setTarget(openTarget);
        // Opening serves the card; it never lingers as a second entry.
        setOffers((current) =>
          current.filter((item) => item.target !== openTarget),
        );
      },
      close: () => setTarget(null),
      offers,
      offer: (next) =>
        setOffers((current) =>
          [
            next,
            ...current.filter((item) => item.target !== next.target),
          ].slice(0, MAX_OFFERS),
        ),
      dismiss: (dismissed) =>
        setOffers((current) =>
          current.filter((item) => item.target !== dismissed),
        ),
    }),
    [target, offers],
  );
  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}

export function usePreview(): PreviewState {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error("usePreview must be used inside PreviewProvider");
  }
  return context;
}

/** Parse "ledger:YYYY-MM" targets; null for anything unknown. */
export function ledgerMonthOf(target: string): string | null {
  const match = target.match(/^ledger:(\d{4}-(?:0[1-9]|1[0-2]))$/);
  return match?.[1] ?? null;
}
