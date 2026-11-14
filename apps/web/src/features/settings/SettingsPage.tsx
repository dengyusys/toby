import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type {
  AiCatalog,
  AiSettingsUpdate,
  AiSettingsView,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { settingsClient } from "@/lib/api.ts";

type Errors = Partial<Record<"model" | "credentials" | "form", string>>;
const inputClass =
  "h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50";

function FieldError({ message, id }: { message?: string; id: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-2 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

function describeSaveError(error: unknown): Errors {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  switch (code) {
    case "SETTINGS_INVALID_MODEL":
      return { model: "此模型不可用，请重新选择。" };
    case "SETTINGS_UNKNOWN_PROVIDER":
      return { credentials: "未识别此供应商，请重新选择。" };
    case "SETTINGS_INVALID_CREDENTIAL":
      return { credentials: "密钥格式无效，请重新输入。" };
    case "SETTINGS_BODY_INVALID":
      return { form: "设置内容无效，请检查后重试。" };
    default:
      return { form: "保存失败，请稍后重试。" };
  }
}

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

function SettingsForm({
  initial,
  catalog,
  catalogPending,
  catalogFailed,
  catalogFetching,
  retryCatalog,
}: {
  initial: AiSettingsView;
  catalog?: AiCatalog;
  catalogPending: boolean;
  catalogFailed: boolean;
  catalogFetching: boolean;
  retryCatalog: () => void;
}) {
  const queryClient = useQueryClient();
  const [effective, setEffective] = useState(initial);
  const [provider, setProvider] = useState(
    initial.model.value?.split("/")[0] ?? "",
  );
  const [model, setModel] = useState(initial.model.value ?? "");
  const [resetModel, setResetModel] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const entry = catalog?.providers.find((item) => item.id === provider);
  const credential = effective.providers.find((item) => item.id === provider);
  const providers = [
    ...new Set([
      ...(catalog?.providers.map((item) => item.id) ?? []),
      ...effective.providers.map((item) => item.id),
      ...(provider ? [provider] : []),
    ]),
  ];
  const modelChanged = resetModel || model !== (effective.model.value ?? "");
  const dirty = modelChanged || !!apiKey || clearKey;
  const catalogReady = !!catalog && !catalogFailed;
  const selectedModel =
    !resetModel && entry?.models.some((name) => `${provider}/${name}` === model)
      ? model
      : "";

  function edit() {
    setErrors({});
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    const nextErrors: Errors = {};
    if (
      modelChanged &&
      !resetModel &&
      !catalog?.providers.some((item) =>
        item.models.some((name) => `${item.id}/${name}` === model),
      )
    )
      nextErrors.model = "请选择模型。";
    if ((apiKey || clearKey) && !provider)
      nextErrors.credentials = "请先选择供应商。";
    setErrors(nextErrors);
    setSaved(false);
    if (Object.keys(nextErrors).length) return;
    const body: AiSettingsUpdate = {};
    if (modelChanged) body.model = resetModel ? null : model;
    if (apiKey) body.credentials = [{ provider, apiKey }];
    else if (clearKey) body.credentials = [{ provider, clear: true }];
    setSaving(true);
    setApiKey("");
    try {
      const result = await settingsClient.saveAiSettings(body);
      queryClient.setQueryData(["settings", "ai"], result);
      setEffective(result);
      setModel(result.model.value ?? "");
      setResetModel(false);
      setClearKey(false);
      setSaved(true);
    } catch (error) {
      setErrors(describeSaveError(error));
    } finally {
      for (const item of body.credentials ?? []) delete item.apiKey;
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      noValidate
      className="rounded-xl border bg-card shadow-sm"
    >
      <fieldset disabled={saving} className="min-w-0 space-y-6 p-5 sm:p-7">
        <legend className="sr-only">模型与密钥</legend>
        <div>
          <label
            htmlFor="ai-provider"
            className="mb-2 block text-sm font-medium"
          >
            供应商
          </label>
          <select
            id="ai-provider"
            className={inputClass}
            value={provider}
            aria-controls="ai-model ai-api-key"
            onChange={(event) => {
              edit();
              setProvider(event.target.value);
              setApiKey("");
              setClearKey(false);
              // Switching context does not change the saved model until a model is chosen.
              setModel(effective.model.value ?? "");
              setResetModel(false);
            }}
          >
            <option value="">选择供应商</option>
            {providers.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="ai-model" className="text-sm font-medium">
              模型
            </label>
            {effective.model.source === "db" && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
                onClick={() => {
                  edit();
                  setResetModel(!resetModel);
                  setModel(effective.model.value ?? "");
                }}
              >
                {resetModel ? "取消恢复" : "恢复环境配置"}
              </button>
            )}
          </div>
          <select
            id="ai-model"
            className={inputClass}
            value={selectedModel}
            disabled={!catalogReady || !entry}
            aria-invalid={!!errors.model}
            aria-describedby="model-error model-status"
            onChange={(event) => {
              edit();
              setModel(event.target.value);
              setResetModel(false);
            }}
          >
            <option value="" disabled>
              {resetModel
                ? "保存后使用环境配置"
                : !provider
                  ? "先选择供应商"
                  : "选择模型"}
            </option>
            {catalogReady &&
              entry?.models.map((name) => (
                <option key={name} value={`${provider}/${name}`}>
                  {name}
                </option>
              ))}
          </select>
          <p
            id="model-status"
            className="mt-2 break-all text-xs text-muted-foreground"
          >
            {resetModel
              ? "保存后恢复环境变量中的模型。"
              : modelChanged
                ? "待保存"
                : effective.model.source === "env"
                  ? "来自环境变量"
                  : !effective.model.value
                    ? "尚未配置模型"
                    : selectedModel
                      ? ""
                      : `当前使用 ${effective.model.value}`}
          </p>
          <FieldError id="model-error" message={errors.model} />
          {catalogPending && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              正在读取模型目录…
            </p>
          )}
          {catalogFailed && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p role="alert" className="text-xs text-muted-foreground">
                无法读取模型目录。
              </p>
              <button
                type="button"
                className="text-xs underline underline-offset-4 disabled:opacity-50"
                disabled={catalogFetching}
                onClick={retryCatalog}
              >
                {catalogFetching ? "读取中…" : "重试"}
              </button>
            </div>
          )}
        </div>
        <div className="border-t pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="ai-api-key" className="text-sm font-medium">
              API key
            </label>
            {credential?.source === "stored" && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
                onClick={() => {
                  edit();
                  setClearKey(!clearKey);
                  setApiKey("");
                }}
              >
                {clearKey ? "取消清除" : "清除密钥"}
              </button>
            )}
          </div>
          <input
            id="ai-api-key"
            type="password"
            className={inputClass}
            value={apiKey}
            disabled={!provider}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={
              clearKey ? "保存后清除密钥" : "输入新密钥，留空则不修改"
            }
            aria-invalid={!!errors.credentials}
            aria-describedby="credentials-error key-status"
            onChange={(event) => {
              edit();
              setApiKey(event.target.value);
              setClearKey(false);
            }}
          />
          <p id="key-status" className="mt-2 text-xs text-muted-foreground">
            {clearKey
              ? "保存后清除，回退到环境变量。"
              : apiKey
                ? "新密钥待保存"
                : credential?.source === "stored"
                  ? `已存储${credential.maskedKey ? ` ${credential.maskedKey}` : ""}`
                  : credential?.source === "env"
                    ? "来自环境变量"
                    : provider
                      ? "尚未配置密钥"
                      : ""}
          </p>
          <FieldError id="credentials-error" message={errors.credentials} />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-7">
        <div aria-live="polite" className="text-xs text-muted-foreground">
          {saving
            ? "正在保存…"
            : saved
              ? "已保存"
              : dirty
                ? "更改尚未保存"
                : ""}
          <FieldError id="form-error" message={errors.form} />
        </div>
        <Button type="submit" disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}
