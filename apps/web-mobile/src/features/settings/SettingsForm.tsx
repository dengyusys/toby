import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import type {
  AiCatalog,
  AiSettingsUpdate,
  AiSettingsView,
} from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { settingsClient } from "@/lib/api.ts";
import { ProviderField } from "./ProviderField.tsx";
import { ModelField } from "./ModelField.tsx";
import { ApiKeyField } from "./ApiKeyField.tsx";
import { FieldError } from "./FieldError.tsx";
import { describeSaveError } from "./save-errors.ts";
import type { SettingsErrors } from "./save-errors.ts";

interface SettingsFormProps {
  initial: AiSettingsView;
  catalog?: AiCatalog;
  pending: boolean;
  failed: boolean;
  fetching: boolean;
  retry: () => void;
}

export function SettingsForm({
  initial,
  catalog,
  pending,
  failed,
  fetching,
  retry,
}: SettingsFormProps) {
  const queryClient = useQueryClient();
  const [effective, setEffective] = useState(initial);
  const [provider, setProvider] = useState(
    initial.model.value?.split("/")[0] ?? "",
  );
  const [model, setModel] = useState(initial.model.value ?? "");
  const [reset, setReset] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clear, setClear] = useState(false);
  const [errors, setErrors] = useState<SettingsErrors>({});
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
  const modelChanged = reset || model !== (effective.model.value ?? "");
  const dirty = modelChanged || !!apiKey || clear;
  const selectedModel =
    !reset && entry?.models.some((name) => `${provider}/${name}` === model)
      ? model
      : "";
  const status = reset
    ? "保存后恢复环境变量中的模型。"
    : modelChanged
      ? "待保存"
      : effective.model.source === "env"
        ? "来自环境变量"
        : !effective.model.value
          ? "尚未配置模型"
          : selectedModel
            ? ""
            : `当前使用 ${effective.model.value}`;

  function edit() {
    setErrors({});
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    const nextErrors: SettingsErrors = {};
    if (
      modelChanged &&
      !reset &&
      !catalog?.providers.some((item) =>
        item.models.some((name) => `${item.id}/${name}` === model),
      )
    )
      nextErrors.model = "请选择模型。";
    if ((apiKey || clear) && !provider)
      nextErrors.credentials = "请先选择供应商。";
    setErrors(nextErrors);
    setSaved(false);
    if (Object.keys(nextErrors).length) return;
    const body: AiSettingsUpdate = {};
    if (modelChanged) body.model = reset ? null : model;
    if (apiKey) body.credentials = [{ provider, apiKey }];
    else if (clear) body.credentials = [{ provider, clear: true }];
    setSaving(true);
    setApiKey("");
    try {
      const result = await settingsClient.saveAiSettings(body);
      queryClient.setQueryData(["settings", "ai"], result);
      setEffective(result);
      setModel(result.model.value ?? "");
      setReset(false);
      setClear(false);
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
      noValidate
      onSubmit={(event) => void save(event)}
      className="rounded-2xl border bg-card"
    >
      <fieldset disabled={saving} className="min-w-0 space-y-5 p-4">
        <legend className="sr-only">模型与密钥</legend>
        <ProviderField
          value={provider}
          providers={providers}
          onChange={(value) => {
            edit();
            setProvider(value);
            setApiKey("");
            setClear(false);
            setModel(effective.model.value ?? "");
            setReset(false);
          }}
        />
        <ModelField
          provider={provider}
          models={entry?.models}
          value={selectedModel}
          reset={reset}
          canReset={effective.model.source === "db"}
          status={status}
          pending={pending}
          failed={failed}
          fetching={fetching}
          error={errors.model}
          onRetry={retry}
          onReset={() => {
            edit();
            setReset(!reset);
            setModel(effective.model.value ?? "");
          }}
          onChange={(value) => {
            edit();
            setModel(value);
            setReset(false);
          }}
        />
        <ApiKeyField
          provider={provider}
          credential={credential}
          value={apiKey}
          clear={clear}
          error={errors.credentials}
          onClear={() => {
            edit();
            setClear(!clear);
            setApiKey("");
          }}
          onChange={(value) => {
            edit();
            setApiKey(value);
            setClear(false);
          }}
        />
      </fieldset>
      <div className="border-t p-4">
        <div aria-live="polite" className="mb-3 text-xs text-muted-foreground">
          {saving
            ? "正在保存…"
            : saved
              ? "已保存"
              : dirty
                ? "更改尚未保存"
                : ""}
          <FieldError id="settings-form-error" message={errors.form} />
        </div>
        <Button
          type="submit"
          disabled={saving || !dirty}
          className="h-12 w-full rounded-xl text-base"
        >
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}
