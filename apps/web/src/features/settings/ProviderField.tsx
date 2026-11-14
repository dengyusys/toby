import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

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
    <div>
      <Label htmlFor="ai-provider" className="mb-2 block text-sm font-medium">
        供应商
      </Label>
      <Select value={provider} disabled={saving} onValueChange={onChange}>
        <SelectTrigger
          id="ai-provider"
          className="w-full rounded-lg data-[size=default]:h-11"
        >
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
