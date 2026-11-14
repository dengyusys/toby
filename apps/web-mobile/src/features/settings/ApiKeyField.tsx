import type { AiSettingsView } from "@toby/contract";
import { FieldError } from "./FieldError.tsx";

interface ApiKeyFieldProps {
  provider: string;
  credential?: AiSettingsView["providers"][number];
  value: string;
  clear: boolean;
  error?: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function ApiKeyField({
  provider,
  credential,
  value,
  clear,
  error,
  onChange,
  onClear,
}: ApiKeyFieldProps) {
  return (
    <div className="border-t pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor="settings-key" className="text-sm font-medium">
          API key
        </label>
        {credential?.source === "stored" && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 px-1 text-xs text-muted-foreground active:text-foreground focus-visible:underline"
          >
            {clear ? "取消清除" : "清除密钥"}
          </button>
        )}
      </div>
      <input
        id="settings-key"
        type="password"
        value={value}
        disabled={!provider}
        autoComplete="new-password"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={clear ? "保存后清除密钥" : "输入新密钥，留空则不修改"}
        aria-invalid={!!error}
        aria-describedby="settings-key-error settings-key-status"
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full min-w-0 rounded-xl border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50"
      />
      <p
        id="settings-key-status"
        className="mt-2 break-all text-xs leading-5 text-muted-foreground"
      >
        {clear
          ? "保存后清除，回退到环境变量。"
          : value
            ? "新密钥待保存"
            : credential?.source === "stored"
              ? `已存储${credential.maskedKey ? ` ${credential.maskedKey}` : ""}`
              : credential?.source === "env"
                ? "来自环境变量"
                : provider
                  ? "尚未配置密钥"
                  : "先选择供应商"}
      </p>
      <FieldError id="settings-key-error" message={error} />
    </div>
  );
}
