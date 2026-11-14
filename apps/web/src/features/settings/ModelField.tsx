import type { AiCatalog, AiSettingsView } from "@toby/contract";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { FieldError } from "./FieldError.tsx";

interface ModelFieldProps {
  effective: AiSettingsView;
  provider: string;
  entry?: AiCatalog["providers"][number];
  selectedModel: string;
  resetModel: boolean;
  modelChanged: boolean;
  saving: boolean;
  catalogReady: boolean;
  catalogPending: boolean;
  catalogFailed: boolean;
  catalogFetching: boolean;
  error?: string;
  retryCatalog: () => void;
  onReset: () => void;
  onChange: (value: string) => void;
}

export function ModelField({
  effective,
  provider,
  entry,
  selectedModel,
  resetModel,
  modelChanged,
  saving,
  catalogReady,
  catalogPending,
  catalogFailed,
  catalogFetching,
  error,
  retryCatalog,
  onReset,
  onChange,
}: ModelFieldProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label htmlFor="ai-model" className="text-sm font-medium">
          模型
        </Label>
        {effective.model.source === "db" && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
            onClick={onReset}
          >
            {resetModel ? "取消恢复" : "恢复环境配置"}
          </button>
        )}
      </div>
      <Select
        value={selectedModel}
        disabled={saving || !catalogReady || !entry}
        onValueChange={onChange}
      >
        <SelectTrigger
          id="ai-model"
          className="w-full rounded-lg data-[size=default]:h-11"
          aria-invalid={!!error}
          aria-describedby="model-error model-status"
        >
          <SelectValue
            placeholder={
              resetModel
                ? "保存后使用环境配置"
                : !provider
                  ? "先选择供应商"
                  : "选择模型"
            }
          />
        </SelectTrigger>
        <SelectContent position="popper">
          {catalogReady &&
            entry?.models.map((name) => (
              <SelectItem key={name} value={`${provider}/${name}`}>
                {name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
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
      <FieldError id="model-error" message={error} />
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
  );
}
