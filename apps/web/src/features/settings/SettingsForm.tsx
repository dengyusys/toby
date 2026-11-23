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
import { FieldError } from "./FieldError.tsx";
import { describeSaveError } from "./save-errors.ts";
import type { Errors } from "./save-errors.ts";
import { ProviderField } from "./ProviderField.tsx";
import { ModelField } from "./ModelField.tsx";
import { ApiKeyField } from "./ApiKeyField.tsx";
import { ChatHistoryField } from "./ChatHistoryField.tsx";
import { describeTestResult } from "./test-result.ts";

export function SettingsForm({
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
  const [apiKey, setApiKey] = useState("");
  const [historyHours, setHistoryHours] = useState(
    String(initial.chatHistoryHours.value),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const [testErrors, setTestErrors] = useState<Errors>({});
  const busy = saving || testing;
  const entry = catalog?.providers.find((item) => item.id === provider);
  const credential = effective.providers.find((item) => item.id === provider);
  const providers = [
    ...new Set([
      ...(catalog?.providers.map((item) => item.id) ?? []),
      ...effective.providers.map((item) => item.id),
      ...(provider ? [provider] : []),
    ]),
  ];
  const modelChanged = model !== (effective.model.value ?? "");
  const historyChanged =
    historyHours.trim() !== String(effective.chatHistoryHours.value);
  const dirty = modelChanged || !!apiKey || historyChanged;
  const catalogReady = !!catalog && !catalogFailed;
  const selectedModel = entry?.models.some(
    (name) => `${provider}/${name}` === model,
  )
    ? model
    : "";

  function edit() {
    setErrors({});
    setSaved(false);
    setTestStatus("");
    setTestErrors({});
  }

  function buildUpdate(): { body: AiSettingsUpdate; errors: Errors } {
    const nextErrors: Errors = {};
    if (
      modelChanged &&
      !catalog?.providers.some((item) =>
        item.models.some((name) => `${item.id}/${name}` === model),
      )
    )
      nextErrors.model = "请选择模型。";
    if (apiKey && !provider) nextErrors.credentials = "请先选择供应商。";
    const body: AiSettingsUpdate = {};
    if (modelChanged) body.model = model;
    if (historyChanged) body.chatHistoryHours = Number(historyHours);
    if (apiKey) body.credentials = [{ provider, apiKey }];
    return { body, errors: nextErrors };
  }

  async function test() {
    if (busy || !catalogReady) return;
    const { body, errors: nextErrors } = buildUpdate();
    setTestErrors(nextErrors);
    setTestStatus("");
    if (Object.keys(nextErrors).length) return;
    setTesting(true);
    try {
      const result = await settingsClient.testAiSettings(body);
      setTestStatus(describeTestResult(result));
    } catch (error) {
      setTestErrors(describeSaveError(error));
    } finally {
      for (const item of body.credentials ?? []) delete item.apiKey;
      setTesting(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    const { body, errors: nextErrors } = buildUpdate();
    setErrors(nextErrors);
    setSaved(false);
    setTestStatus("");
    setTestErrors({});
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setApiKey("");
    try {
      const result = await settingsClient.saveAiSettings(body);
      queryClient.setQueryData(["settings", "ai"], result);
      setEffective(result);
      setModel(result.model.value ?? "");
      setHistoryHours(String(result.chatHistoryHours.value));
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
      <fieldset disabled={busy} className="min-w-0 space-y-6 p-5 sm:p-7">
        <legend className="sr-only">模型、密钥与对话记忆</legend>
        <ProviderField
          provider={provider}
          providers={providers}
          saving={busy}
          onChange={(value) => {
            edit();
            setProvider(value);
            setApiKey("");
            // A provider switch resets the draft to the saved model; only an
            // explicit model pick changes it.
            setModel(effective.model.value ?? "");
          }}
        />
        <ModelField
          effective={effective}
          provider={provider}
          entry={entry}
          selectedModel={selectedModel}
          modelChanged={modelChanged}
          saving={busy}
          catalogReady={catalogReady}
          catalogPending={catalogPending}
          catalogFailed={catalogFailed}
          catalogFetching={catalogFetching}
          retryCatalog={retryCatalog}
          error={errors.model ?? testErrors.model}
          onChange={(value) => {
            edit();
            setModel(value);
          }}
        />
        <ApiKeyField
          provider={provider}
          credential={credential}
          apiKey={apiKey}
          testing={testing}
          testDisabled={busy || !catalogReady}
          onTest={() => void test()}
          error={errors.credentials ?? testErrors.credentials}
          onChange={(value) => {
            edit();
            setApiKey(value);
          }}
        />
        {(testing || testStatus) && (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {testing ? "正在测试…" : testStatus}
          </p>
        )}
        <FieldError id="test-error" message={testErrors.form} />
        <ChatHistoryField
          value={historyHours}
          onChange={(value) => {
            edit();
            setHistoryHours(value);
          }}
        />
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
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !dirty}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </form>
  );
}
