import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button.tsx";
import { settingsClient } from "@/lib/api.ts";
import { PasswordForm } from "./PasswordForm.tsx";
import { SettingsForm } from "./SettingsForm.tsx";

/** One section title on the settings page: a level under the page title. */
const SECTION_HEADING = "mb-4 font-serif text-lg font-semibold tracking-tight";

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
            设置
          </h1>
        </header>
        <section aria-labelledby="settings-model-heading">
          <h2 id="settings-model-heading" className={SECTION_HEADING}>
            模型
          </h2>
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
        </section>
        <section aria-labelledby="settings-password-heading" className="mt-10">
          <h2 id="settings-password-heading" className={SECTION_HEADING}>
            登录密码
          </h2>
          <PasswordForm />
        </section>
      </div>
    </div>
  );
}
