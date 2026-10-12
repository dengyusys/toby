import { useQuery } from "@tanstack/react-query";
import { StatusDot } from "@/components/StatusDot.tsx";
import { systemClient } from "@/lib/api.ts";

export function HealthPage() {
  const health = useQuery({
    queryKey: ["system", "health"],
    queryFn: () => systemClient.health(),
  });
  const info = useQuery({
    queryKey: ["system", "info"],
    queryFn: () => systemClient.info(),
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <StatusDot
            state={health.isError ? "error" : health.data ? "ok" : "pending"}
          />
          <h2 className="text-sm font-medium">Server health</h2>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {health.isPending
            ? "checking…"
            : health.isError
              ? `unreachable: ${health.error.message}`
              : health.data.status}
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-sm font-medium">Server info</h2>
        {info.isPending ? (
          <p className="mt-1.5 text-xs text-muted-foreground">loading…</p>
        ) : info.isError ? (
          <p className="mt-1.5 text-xs text-destructive">
            {info.error.message}
          </p>
        ) : (
          <dl className="mt-2 flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">name</dt>
              <dd>{info.data.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">version</dt>
              <dd>{info.data.version}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">node</dt>
              <dd>{info.data.node}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">started at</dt>
              <dd>{info.data.started_at}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">uptime</dt>
              <dd>{info.data.uptime_seconds}s</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
