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
    <div className="flex flex-col gap-6 py-10">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <StatusDot
            state={health.isError ? "error" : health.data ? "ok" : "pending"}
          />
          <h2 className="text-sm font-medium">Server health</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {health.isPending
            ? "checking…"
            : health.isError
              ? `unreachable: ${health.error.message}`
              : health.data.status}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium">Server info</h2>
        {info.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">loading…</p>
        ) : info.isError ? (
          <p className="mt-2 text-sm text-destructive">{info.error.message}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">name</dt>
            <dd>{info.data.name}</dd>
            <dt className="text-muted-foreground">version</dt>
            <dd>{info.data.version}</dd>
            <dt className="text-muted-foreground">node</dt>
            <dd>{info.data.node}</dd>
            <dt className="text-muted-foreground">started at</dt>
            <dd>{info.data.started_at}</dd>
            <dt className="text-muted-foreground">uptime</dt>
            <dd>{info.data.uptime_seconds}s</dd>
          </dl>
        )}
      </section>
    </div>
  );
}
