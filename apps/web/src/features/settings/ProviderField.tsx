import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { FORM_ROW, FORM_ROW_LABEL } from "./form-row.ts";

interface ProviderFieldProps {
  provider: string;
  providers: string[];
  saving: boolean;
  onChange: (value: string) => void;
}

export function ProviderField({
  provider,
  providers,
  saving,
  onChange,
}: ProviderFieldProps) {
  return (
    <div className={FORM_ROW}>
      <Label htmlFor="ai-provider" className={FORM_ROW_LABEL}>
        供应商
      </Label>
      <Select value={provider} disabled={saving} onValueChange={onChange}>
        <SelectTrigger id="ai-provider" className="w-full">
          <SelectValue placeholder="选择供应商" />
        </SelectTrigger>
        <SelectContent position="popper">
          {providers.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
