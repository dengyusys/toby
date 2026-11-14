import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { settingsClient } from "@/lib/api.ts";
import { SettingsForm } from "./SettingsForm.tsx";

export function SettingsPage() {
  const settings = useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => settingsClient.getAiSettings(),
    refetchOnWindowFocus: false,
  });
  const catalog = useQuery({
    queryKey: ["settings", "ai", "catalog"],
    queryFn: () => settingsClient.getCatalog(),
  });
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">
          模型设置
        </h1>
        {settings.isPending ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            正在读取设置…
          </p>
        ) : settings.isError ? (
          <section className="rounded-2xl border bg-card p-4">
            <p role="alert" className="text-sm text-destructive">
              无法读取设置。
            </p>
            <Button
              variant="outline"
              className="mt-3 min-h-11"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              重新读取
            </Button>
          </section>
        ) : (
          <SettingsForm
            initial={settings.data}
            catalog={catalog.data}
            pending={catalog.isPending}
            failed={catalog.isError}
            fetching={catalog.isFetching}
            retry={() => void catalog.refetch()}
          />
        )}
      </div>
    </div>
  );
}
