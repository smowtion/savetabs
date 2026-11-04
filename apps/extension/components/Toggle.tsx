/**
 * Accessible on/off switch for boolean settings.
 *
 * A native button with `role="switch"` keeps keyboard and assistive-technology
 * behavior free; the visual track is purely decorative. The accessible name is
 * required because the control renders without visible text.
 */

export type ToggleProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function Toggle({
  id,
  checked,
  onChange,
  label,
  disabled = false,
}: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed ${
        checked
          ? "bg-blue-600 disabled:bg-blue-300 dark:bg-blue-500 dark:disabled:bg-blue-900"
          : "bg-neutral-300 disabled:bg-neutral-200 dark:bg-neutral-700 dark:disabled:bg-neutral-800"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-neutral-100 ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
