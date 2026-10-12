import { cn } from "cn";

export type StatusDotState = "ok" | "error" | "pending";

const DOT_COLORS: Record<StatusDotState, string> = {
  ok: "bg-primary",
  error: "bg-destructive",
  pending: "bg-muted-foreground",
};

/** Small status indicator shared by pages that poll server state. */
export function StatusDot({
  state,
  className,
}: {
  state: StatusDotState;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 rounded-full",
        DOT_COLORS[state],
        className,
      )}
    />
  );
}
