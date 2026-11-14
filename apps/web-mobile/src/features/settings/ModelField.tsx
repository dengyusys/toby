import { FieldError } from "./FieldError.tsx";

interface ModelFieldProps {
  provider: string;
  models?: string[];
  value: string;
  reset: boolean;
  canReset: boolean;
  status: string;
  pending: boolean;
  failed: boolean;
  fetching: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onRetry: () => void;
}

export function ModelField({
  provider,
  models,
  value,
  reset,
  canReset,
  status,
  pending,
  failed,
  fetching,
  error,
  onChange,
  onReset,
  onRetry,
}: ModelFieldProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor="settings-model" className="text-sm font-medium">
          模型
        </label>
        {canReset && (
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 px-1 text-xs text-muted-foreground active:text-foreground focus-visible:underline"
          >
            {reset ? "取消恢复" : "恢复环境配置"}
          </button>
        )}
      </div>
      <select
        id="settings-model"
        value={value}
        disabled={pending || failed || !models}
        aria-invalid={!!error}
        aria-describedby="settings-model-error settings-model-status"
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full min-w-0 rounded-xl border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50"
      >
        <option value="" disabled>
          {reset
            ? "保存后使用环境配置"
            : provider
              ? "选择模型"
              : "先选择供应商"}
        </option>
        {!failed &&
          models?.map((name) => (
            <option key={name} value={`${provider}/${name}`}>
              {name}
            </option>
          ))}
      </select>
      <p
        id="settings-model-status"
        className="mt-2 break-all text-xs leading-5 text-muted-foreground"
      >
        {status}
      </p>
      <FieldError id="settings-model-error" message={error} />
      {pending && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          正在读取模型目录…
        </p>
      )}
      {failed && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-muted-foreground">
            无法读取模型目录。
          </p>
          <button
            type="button"
            disabled={fetching}
            onClick={onRetry}
            className="min-h-11 px-2 text-xs underline underline-offset-4 disabled:opacity-50"
          >
            {fetching ? "读取中…" : "重试"}
          </button>
        </div>
      )}
    </div>
  );
}
