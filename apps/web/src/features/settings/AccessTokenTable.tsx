/**
 * The live access tokens, one row each: what it is called, when it was
 * created, when it was last used — and the one button that ends it. With no
 * token yet the table stays, with a single line saying so.
 */

import type { AccessTokenView } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";

// The short numeric form keeps the two date columns narrow enough to sit
// beside the name in a table that has only a card's width.
const DAY = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short" });
const DAY_AND_TIME = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "short",
});

// The wrapper is the query root, and `@[30rem]` marks the layout the table
// takes once the card is wide enough for all four columns at full padding.
// Below it the creation date goes first, then the time of day and half the
// padding, so "revoke" always stays in view. The classes are spelled out in
// full: the style tool only generates a class it can read in the source.
const COLUMN_COUNT = 4;

interface AccessTokenTableProps {
  tokens: AccessTokenView[];
  /** The id whose revocation is in flight; every row waits while one does. */
  revokingId?: string;
  onRevoke: (id: string) => void;
}

export function AccessTokenTable({
  tokens,
  revokingId,
  onRevoke,
}: AccessTokenTableProps) {
  return (
    <div className="@container overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th
              scope="col"
              className="px-3 py-2 font-medium whitespace-nowrap @[30rem]:px-4"
            >
              名字
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2 font-medium whitespace-nowrap @[30rem]:table-cell @[30rem]:px-4"
            >
              创建时间
            </th>
            <th
              scope="col"
              className="px-3 py-2 font-medium whitespace-nowrap @[30rem]:px-4"
            >
              最近使用
            </th>
            <th scope="col" className="px-3 py-2 font-medium @[30rem]:px-4">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 && (
            <tr>
              <td
                colSpan={COLUMN_COUNT}
                className="px-4 py-8 text-center text-muted-foreground"
              >
                还没有令牌。
              </td>
            </tr>
          )}
          {tokens.map((token) => (
            <tr key={token.id} className="border-b last:border-b-0">
              {/* The full width with a zero max-width is what lets this one
                  column give up space and cut a long name — down to the
                  minimum, past which the table scrolls instead; the whole
                  name is in the hover title. */}
              <td
                className="w-full min-w-[5rem] max-w-0 truncate px-3 py-2.5 font-medium @[30rem]:min-w-[8rem] @[30rem]:px-4"
                title={token.name}
              >
                {token.name}
              </td>
              <td className="hidden px-3 py-2.5 text-muted-foreground whitespace-nowrap @[30rem]:table-cell @[30rem]:px-4">
                {DAY_AND_TIME.format(new Date(token.created_at))}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap @[30rem]:px-4">
                {token.last_used_at ? (
                  <>
                    <span className="@[30rem]:hidden">
                      {DAY.format(new Date(token.last_used_at))}
                    </span>
                    <span className="hidden @[30rem]:inline">
                      {DAY_AND_TIME.format(new Date(token.last_used_at))}
                    </span>
                  </>
                ) : (
                  "从未使用"
                )}
              </td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap @[30rem]:px-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokingId !== undefined}
                  onClick={() => onRevoke(token.id)}
                >
                  {revokingId === token.id ? "撤销中…" : "撤销"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
