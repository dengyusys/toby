import type { AiSettingsView } from "@toby/contract";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { FieldError } from "./FieldError.tsx";
import { FORM_ROW, FORM_ROW_LABEL } from "./form-row.ts";

interface ApiKeyFieldProps {
  provider: string;
  credential?: AiSettingsView["providers"][number];
  apiKey: string;
  /** The probe rides the header row: it tests the model plus this key. */
  testing: boolean;
  testDisabled: boolean;
  onTest: () => void;
  error?: string;
  onChange: (value: string) => void;
}

export function ApiKeyField({
  provider,
  credential,
  apiKey,
  testing,
  testDisabled,
  onTest,
  error,
  onChange,
}: ApiKeyFieldProps) {
  return (
    <div className={FORM_ROW}>
      <Label htmlFor="ai-api-key" className={FORM_ROW_LABEL}>
        API key
      </Label>
      <div>
        {/* The probe sits with the key it tests: same row, same height. */}
        <div className="flex gap-2">
          <Input
            id="ai-api-key"
            type="password"
            className="min-w-0 flex-1"
            value={apiKey}
            disabled={!provider}
            autoComplete="new-password"
            spellCheck={false}
            placeholder="输入新密钥，留空则不修改"
            aria-invalid={!!error}
            aria-describedby="credentials-error key-status"
            onChange={(event) => onChange(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={testDisabled}
            onClick={onTest}
          >
            {testing ? "测试中…" : "测试"}
          </Button>
        </div>
        <p id="key-status" className="mt-1.5 text-xs text-muted-foreground">
          {apiKey
            ? "新密钥待保存"
            : credential?.source === "stored"
              ? `已存储${credential.masked_key ? ` ${credential.masked_key}` : ""}`
              : credential?.source === "env"
                ? "来自环境变量"
                : provider
                  ? "尚未配置密钥"
                  : ""}
        </p>
        <FieldError id="credentials-error" message={error} />
      </div>
    </div>
  );
}
