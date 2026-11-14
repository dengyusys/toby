export function ProviderField({
  value,
  providers,
  onChange,
}: {
  value: string;
  providers: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor="settings-provider"
        className="mb-2 block text-sm font-medium"
      >
        供应商
      </label>
      <select
        id="settings-provider"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full min-w-0 rounded-xl border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50"
      >
        <option value="">选择供应商</option>
        {providers.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>
  );
}
