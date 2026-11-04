/**
 * Native select for enum settings.
 *
 * Options arrive pre-translated; the component only deals in DOM string values
 * so callers keep ownership of converting them back to schema values.
 */

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = {
  id: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
};

export function Select({
  id,
  value,
  options,
  onChange,
  label,
  disabled = false,
}: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      disabled={disabled}
      className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
