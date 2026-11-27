/**
 * The model tab of the settings page: which model answers, the provider
 * keys, and the conversation window.
 */

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { settingsClient } from "@/lib/api.ts";
import { SettingsForm } from "./SettingsForm.tsx";

export function AiSettingsTab() {
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
    // The tab's name is in the tab bar; the heading keeps the page outline
    // for screen readers.
    <>
      <h2 className="sr-only">模型</h2>
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
    </>
  );
}
