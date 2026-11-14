import type { AiSettingsView } from "@toby/contract";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { FieldError } from "./FieldError.tsx";

interface ApiKeyFieldProps {
  provider: string;
  credential?: AiSettingsView["providers"][number];
  apiKey: string;
  clearKey: boolean;
  error?: string;
  onClear: () => void;
  onChange: (value: string) => void;
}

export function ApiKeyField({
  provider,
  credential,
  apiKey,
  clearKey,
  error,
  onClear,
  onChange,
}: ApiKeyFieldProps) {
  return (
    <div className="border-t pt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label htmlFor="ai-api-key" className="text-sm font-medium">
          API key
        </Label>
        {credential?.source === "stored" && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
            onClick={onClear}
          >
            {clearKey ? "取消清除" : "清除密钥"}
          </button>
        )}
      </div>
      <Input
        id="ai-api-key"
        type="password"
        className="h-11 rounded-lg"
        value={apiKey}
        disabled={!provider}
        autoComplete="new-password"
        spellCheck={false}
        placeholder={clearKey ? "保存后清除密钥" : "输入新密钥，留空则不修改"}
        aria-invalid={!!error}
        aria-describedby="credentials-error key-status"
        onChange={(event) => onChange(event.target.value)}
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
      <FieldError id="credentials-error" message={error} />
    </div>
  );
}
