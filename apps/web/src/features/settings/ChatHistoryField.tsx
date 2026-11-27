import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { FORM_ROW, FORM_ROW_LABEL } from "./form-row.ts";

/** The offered conversation windows, whole hours. */
const PRESET_HOURS = [6, 24, 72];

interface ChatHistoryFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function ChatHistoryField({ value, onChange }: ChatHistoryFieldProps) {
  // An effective value outside the presets (an env-configured window)
  // stays selectable, so the group never shows a state it cannot display.
  const hours = [...new Set([...PRESET_HOURS, Number(value)])].sort(
    (a, b) => a - b,
  );
  return (
    <div className={FORM_ROW}>
      <span className={FORM_ROW_LABEL}>对话记忆时长</span>
      <div>
        <ToggleGroup
          type="single"
          value={value}
          aria-label="对话记忆时长"
          onValueChange={(next) => {
            // Radix fires "" when the active item is tapped again — not a
            // choice; the window stays as it was.
            if (next.length > 0) onChange(next);
          }}
        >
          {hours.map((preset) => (
            <ToggleGroupItem key={preset} value={String(preset)}>
              {preset} 小时
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p
          id="chat-history-status"
          className="mt-1.5 text-xs text-muted-foreground"
        >
          保存后，下一条消息起生效。
        </p>
      </div>
    </div>
  );
}
