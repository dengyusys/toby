/**
 * The preview-panel context (mobile copy — nothing is shared with the PC
 * app): inspect links open previews full-screen by target id.
 */

import { createContext, useContext, useMemo, useState } from "react";

export interface PreviewState {
  /** The open panel's target id, or null when closed. */
  target: string | null;
  open: (target: string) => void;
  close: () => void;
}

const PreviewContext = createContext<PreviewState | null>(null);

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<string | null>(null);
  const value = useMemo<PreviewState>(
    () => ({ target, open: setTarget, close: () => setTarget(null) }),
    [target],
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
