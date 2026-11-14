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
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="mb-7 pr-12">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">
            模型设置
          </h1>
        </header>
        {settings.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取设置…
          </p>
        ) : settings.isError ? (
          <div>
            <p role="alert" className="text-sm text-destructive">
              无法读取设置。
            </p>
            <Button
              variant="outline"
              className="mt-3"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              重新读取
            </Button>
          </div>
        ) : (
          <SettingsForm
            initial={settings.data}
            catalog={catalog.data}
            catalogPending={catalog.isPending}
            catalogFailed={catalog.isError}
            catalogFetching={catalog.isFetching}
            retryCatalog={() => void catalog.refetch()}
          />
        )}
      </div>
    </div>
  );
}
