/**
 * The live access tokens, one row each: what it is called, what it may do,
 * when it ends, when it was last used — and the one button that ends it.
 */

import type { AccessTokenView } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";

const DATE = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface AccessTokenListProps {
  tokens: AccessTokenView[];
  /** The id whose revocation is in flight; every row waits while one does. */
  revokingId?: string;
  onRevoke: (id: string) => void;
}

export function AccessTokenList({
  tokens,
  revokingId,
  onRevoke,
}: AccessTokenListProps) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {tokens.map((token) => (
        <li
          key={token.id}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{token.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {token.scopes.includes("write") ? "读写" : "只读"}
              {" · "}
              创建于 {DATE.format(new Date(token.created_at))}
              {" · "}
              {token.expires_at
                ? `${DATE.format(new Date(token.expires_at))} 过期`
                : "永不过期"}
              {" · "}
              {token.last_used_at
                ? `最近使用 ${DATE.format(new Date(token.last_used_at))}`
                : "从未使用"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={revokingId !== undefined}
            onClick={() => onRevoke(token.id)}
          >
            {revokingId === token.id ? "撤销中…" : "撤销"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
